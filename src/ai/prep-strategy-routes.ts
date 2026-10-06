import type { Hono } from 'hono'
import { generateText, Output } from 'ai'
import { createDeepSpaceAI, createUserToolExecutor, resolveDeepSpaceAgentModel } from 'deepspace/worker'
import type { AgentToolAccessResult } from 'deepspace/worker'
import type { RecordData } from 'deepspace'
import type { AppContext, Env } from '../../worker'
import type { Interview, PrepArea, PrepPlan } from '../schemas/prep-schema'
import { PREP_STRATEGY_LIMITS as limits, PREP_STRATEGY_PROMPT, prepStrategyRequestSchema, prepStrategySchema, validatePrepStrategy } from './prep-strategy-contract'

type ReadResult<T> = { success: boolean; data?: { records?: RecordData<T>[]; record?: RecordData<T> } }

/** Strategic generation has a fixed read surface; no model tools or write executor. */
export function registerPrepStrategyRoutes(app: Hono<AppContext>, resolveAccess: (request: Request, env: Env) => Promise<AgentToolAccessResult>) {
  app.post('/api/ai/prep-strategy', async (c) => {
    const access = await resolveAccess(c.req.raw, c.env)
    if (!access.ok) return c.json({ error: access.status === 401 ? 'Please sign in.' : access.status === 403 ? 'Preparation access denied.' : 'Could not verify access. Please retry.' }, access.status)
    const input = prepStrategyRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'Choose an interview or enter a preparation goal (up to 500 characters).' }, 400)
    const jwt = c.req.header('Authorization')?.slice(7)
    if (!jwt) return c.json({ error: 'Please sign in.' }, 401)
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(90000)])
    const read = createUserToolExecutor(c.env, access.auth.userId, signal)
    try {
      let interview: RecordData<Interview> | undefined
      if (input.data.interviewId) {
        const result = await read('records.get', { collection: 'interviews', recordId: input.data.interviewId }) as ReadResult<Interview>
        interview = result.success ? result.data?.record : undefined
        if (!interview || interview.createdBy !== access.auth.userId) return c.json({ error: 'The selected Interview is unavailable.' }, 404)
        const existing = await read('records.query', { collection: 'prep-plans', where: { userId: access.auth.userId, interviewId: interview.recordId }, limit: 1 }) as ReadResult<PrepPlan>
        if (!existing.success || !existing.data?.records) throw new Error('Could not check existing prep plans.')
        if (existing.data.records.length) return c.json({ error: 'This interview already has a prep plan. Open it from Plans.', existingPrepPlanId: existing.data.records[0]!.recordId }, 409)
      }
      const result = await read('records.query', { collection: 'prep-areas', orderBy: 'createdAt', orderDir: 'desc', limit: limits.areas }) as ReadResult<PrepArea>
      if (!result.success || !result.data?.records) throw new Error('Could not read Prep Areas.')
      const areas = result.data.records.filter((row) => row.createdBy === access.auth.userId).slice(0, limits.areas)
      const context = {
        asOf: new Date().toISOString(),
        ...(interview ? { interview: {
          id: interview.recordId, company: interview.data.company.slice(0, limits.nameChars),
          role: interview.data.role?.slice(0, limits.nameChars), stage: interview.data.stage?.slice(0, limits.nameChars),
          scheduledDate: interview.data.scheduledDate?.slice(0, 40), notes: interview.data.notes?.slice(0, limits.interviewNotesChars),
          prepAreaIds: interview.data.prepAreaIds.filter((id) => areas.some((area) => area.recordId === id)).slice(0, limits.areas),
        } } : { goal: input.data.goal }),
        prepAreas: areas.map((area) => ({ id: area.recordId, name: area.data.name.slice(0, limits.nameChars), notes: area.data.notes?.slice(0, limits.areaNotesChars) })),
      }
      const selection = resolveDeepSpaceAgentModel(undefined, 'application')
      if (!selection) throw new Error('Application model unavailable.')
      const provider = createDeepSpaceAI(c.env, selection.provider, { authToken: jwt })
      const generated = await generateText({
        model: provider(selection.modelId), instructions: PREP_STRATEGY_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(context) }],
        output: Output.object({ schema: prepStrategySchema }), maxOutputTokens: 1800, maxRetries: 0, abortSignal: signal,
      })
      return c.json({ proposal: validatePrepStrategy(generated.output, areas.map((area) => area.recordId)) })
    } catch {
      // Never log interview notes, goals, model text or caller credentials.
      return c.json({ error: signal.aborted ? 'Generation was cancelled or timed out. Retry or continue manually.' : 'A prep plan could not be generated. Retry or continue manually.' }, 502)
    }
  })
}
