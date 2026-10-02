import type { Hono } from 'hono'
import { generateText, isStepCount, Output } from 'ai'
import { createDeepSpaceAI, createUserToolExecutor, resolveDeepSpaceAgentModel } from 'deepspace/worker'
import type { AgentToolAccessResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker'
import { buildSystemPrompt, type buildTools } from './tools'
import { prepReader } from './prep-context'
import { plannerRequestSchema, recommendationSchema, validateRecommendation, type PlannerResponse } from './planner-contract'

import { plannerErrorDiagnostics } from './planner-diagnostics'

type ResolveAccess = (request: Request, env: Env) => Promise<AgentToolAccessResult>

export function registerPlannerRoutes(app: Hono<AppContext>, resolveAccess: ResolveAccess, toolsFactory: typeof buildTools) {
  app.post('/api/ai/prep-plan', async (c) => {
    const correlationId = crypto.randomUUID()
    let stage = 'authentication'
    const mark = (next: string, metadata: Record<string, string | number> = {}) => {
      stage = next
      console.info('[prep-planner]', { correlationId, stage, ...metadata })
    }
    const access = await resolveAccess(c.req.raw, c.env)
    if (!access.ok) return c.json({ error: access.status === 401 ? 'Please sign in.' : access.status === 403 ? 'Preparation access denied.' : 'Could not verify access. Please retry.' }, access.status)
    mark('authentication_complete')
    const input = plannerRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'Enter available minutes (1–1440) and an optional goal.' }, 400)
    const jwt = c.req.header('Authorization')?.slice(7)
    if (!jwt) return c.json({ error: 'Please sign in.' }, 401)
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(90000)])
    const executor = createUserToolExecutor(c.env, access.auth.userId, signal)
    const reader = prepReader(executor)
    const readTools: string[] = []
    let snapshotSucceeded = false
    let coverageNotices: string[] = []
    try {
      const areas = await executor('records.query', { collection: 'prep-areas', limit: 1 }) as { success: boolean; data?: { records: unknown[] } }
      if (!areas.success) throw new Error('Could not read preparation.')
      if (!areas.data?.records.length) return c.json({ error: 'Create a Prep Area in My Prep before asking for a plan.', code: 'prep_area_required' }, 409)
      const selection = resolveDeepSpaceAgentModel(undefined, 'application')
      if (!selection) throw new Error('The application model is unavailable.')
      mark('model_provider_resolved', { provider: selection.provider, model: selection.modelId, availableMinutes: input.data.availableMinutes })
      const provider = createDeepSpaceAI(c.env, selection.provider, { authToken: jwt })
      const tools = toolsFactory(executor)
      // We own the short loop when using generateText directly. Bound tool
      // executions as well as model steps (one step may call tools in parallel).
      const detailExecute = tools.get_work_context.execute
      if (!detailExecute) throw new Error('The work-context tool is unavailable.')
      let detailCalls = 0
      tools.get_work_context = { ...tools.get_work_context, execute: (input, options) => {
        if (detailCalls++ >= 2) throw new Error('Work-context limit reached. Use the context already read.')
        return detailExecute(input, options)
      } }
      mark('generation_started')
      const result = await generateText({
        model: provider(selection.modelId), instructions: buildSystemPrompt(c.env.APP_NAME), tools,
        messages: [{ role: 'user', content: JSON.stringify({ ...input.data, serverNow: new Date().toISOString() }) }],
        output: Output.object({ schema: recommendationSchema }), maxOutputTokens: 2500, maxRetries: 0,
        stopWhen: isStepCount(4), abortSignal: signal,
        // Automatic calling is supported by the resolved Anthropic model;
        // grounding is enforced below, never by a forced provider tool choice.
        toolChoice: 'auto',
        prepareStep: ({ stepNumber }) => stepNumber >= 3 || detailCalls >= 2
          ? { activeTools: [], toolChoice: 'none' }
          : { activeTools: snapshotSucceeded ? ['get_work_context'] : ['get_prep_snapshot'], toolChoice: 'auto' },
        onToolExecutionStart: ({ toolCall }) => mark('tool_execution_started', { toolName: toolCall.toolName }),
        onToolExecutionEnd: ({ toolCall, toolOutput }) => {
          if (toolCall.toolName === 'get_prep_snapshot' && toolOutput.type === 'tool-result') snapshotSucceeded = true
          mark(toolOutput.type === 'tool-error' ? 'tool_execution_failed' : 'tool_execution_completed', { toolName: toolCall.toolName })
          if (toolOutput.type === 'tool-error') console.error('[prep-planner] tool failed', { correlationId, stage, toolName: toolCall.toolName, ...plannerErrorDiagnostics(toolOutput.error) })
        },
        onStepEnd: ({ toolResults, finishReason, stepNumber }) => {
          mark('model_step_completed', { stepNumber, finishReason, toolResults: toolResults.length })
          for (const entry of toolResults) {
            readTools.push(entry.toolName)
            if (entry.toolName === 'get_prep_snapshot' && !entry.dynamic) coverageNotices = entry.output.coverageNotices
          }
        },
      })
      const output = result.output
      mark('structured_output_received')
      mark('recommendation_validation')
      const recommendation = validateRecommendation(output, input.data.availableMinutes)
      if (!snapshotSucceeded) throw new Error('The planner did not read preparation.')
      mark('canonical_enrichment')
      const display = await reader.enrich(recommendation)
      console.info('[prep-planner] accepted output', { correlationId, stage: 'complete', model: selection.modelId, readTools, items: recommendation.items.length })
      const response: PlannerResponse = { recommendation, availableMinutes: input.data.availableMinutes,
        totalMinutes: recommendation.items.reduce((sum, item) => sum + item.estimatedMinutes, 0), generatedAt: new Date().toISOString(), display, coverageNotices, readTools }
      return c.json(response)
    } catch (error) {
      console.error('[prep-planner] failed', { correlationId, stage, ...plannerErrorDiagnostics(error) })
      return c.json({ error: signal.aborted ? 'Planning was cancelled or timed out. Please retry.' : 'A valid plan could not be generated. Your preparation has not changed. Please retry.' }, 502)
    }
  })
}
