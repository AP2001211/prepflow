import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { createDeepSpaceAI, createUserToolExecutor, resolveDeepSpaceAgentModel } from 'deepspace/worker'
import type { AgentToolAccessResult } from 'deepspace/worker'
import type { AppContext } from '../../worker'
import { registerPlannerRoutes } from './planner-routes'
import { buildTools } from './tools'
import { contextFixture, existingProposal } from './planner-test-fixture'

// Replace only the external model and record transport boundaries. The AI SDK
// generateText loop, Zod parsing, tools, enrichment and Hono handler stay real.
vi.mock('deepspace/worker', async (importOriginal) => ({
  ...await importOriginal<typeof import('deepspace/worker')>(),
  createDeepSpaceAI: vi.fn(),
  createUserToolExecutor: vi.fn(),
}))

function step(content: LanguageModelV4GenerateResult['content'], reason: 'tool-calls' | 'stop' = 'stop'): LanguageModelV4GenerateResult {
  return { content, finishReason: { unified: reason, raw: reason }, warnings: [],
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } }
}
const snapshotStep = () => step([{ type: 'tool-call', toolCallId: 'snapshot', toolName: 'get_prep_snapshot', input: '{}' }], 'tool-calls')
const outputStep = (value: unknown) => step([{ type: 'text', text: JSON.stringify(value) }])

function fixture(responses = [snapshotStep(), outputStep(existingProposal)]) {
  const f = contextFixture()
  const model = new MockLanguageModelV4({ doGenerate: responses })
  const factory = vi.fn(() => model)
  vi.mocked(createDeepSpaceAI).mockReturnValue(factory)
  vi.mocked(createUserToolExecutor).mockReturnValue(f.executor)
  const app = new Hono<AppContext>()
  let access: AgentToolAccessResult = { ok: true, auth: { userId: 'alice', claims: { sub: 'alice', isTestAccount: true } } }
  const resolveAccess = vi.fn(async () => access)
  registerPlannerRoutes(app, resolveAccess, buildTools)
  const request = (body: unknown = { availableMinutes: 30 }) => app.request('/api/ai/prep-plan', {
    method: 'POST', headers: { Authorization: 'Bearer caller-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { APP_NAME: 'PrepFlow' })
  return { ...f, model, factory, app, request, resolveAccess, deny: (status: 401 | 403 | 503) => { access = { ok: false, status } } }
}

beforeEach(() => { vi.clearAllMocks() })

describe('DeepSpace structured planner integration (no live provider)', () => {
  it('executes the snapshot through the caller executor, then parses and enriches strict structured output', async () => {
    const f = fixture(); const before = structuredClone(f.tables)
    const response = await f.request()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ recommendation: existingProposal, availableMinutes: 30, totalMinutes: 30, readTools: ['get_prep_snapshot'],
      display: [{ intent: 'Window functions', prepAreaName: 'SQL', previouslyStarted: false }] })
    expect(createUserToolExecutor).toHaveBeenCalledWith(expect.anything(), 'alice', expect.any(AbortSignal))
    const selected = resolveDeepSpaceAgentModel(undefined, 'application')
    expect(createDeepSpaceAI).toHaveBeenCalledWith(expect.anything(), selected?.provider, { authToken: 'caller-jwt' })
    expect(f.factory).toHaveBeenCalledWith(selected?.modelId)
    expect(f.model.doGenerateCalls).toHaveLength(2)
    expect(f.model.doGenerateCalls[0]?.responseFormat).toMatchObject({ type: 'json', schema: expect.any(Object) })
    expect(f.model.doGenerateCalls[0]?.toolChoice).toEqual({ type: 'auto' })
    expect(f.model.doGenerateCalls.every((call) => call.toolChoice?.type !== 'tool' && call.toolChoice?.type !== 'required')).toBe(true)
    expect(f.model.doGenerateCalls[1]?.prompt.some((message) => message.role === 'tool')).toBe(true)
    expect(f.executor.mock.calls.every(([name]) => name === 'records.get' || name === 'records.query')).toBe(true)
    expect(f.tables).toEqual(before)
  })
  it('correlates safe stage/tool diagnostics without logging goals or tool data', async () => {
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const f = fixture()
      expect((await f.request({ availableMinutes: 30, goal: 'PRIVATE GOAL' })).status).toBe(200)
      const events = logs.mock.calls.flatMap(([, value]) => value && typeof value === 'object' && 'correlationId' in value ? [value] : [])
      expect(new Set(events.map((event) => event.correlationId)).size).toBe(1)
      expect(events.map((event) => event.stage)).toEqual(expect.arrayContaining(['authentication_complete', 'model_provider_resolved', 'generation_started', 'tool_execution_started', 'tool_execution_completed', 'model_step_completed', 'structured_output_received', 'recommendation_validation', 'canonical_enrichment']))
      expect(JSON.stringify(events)).not.toMatch(/PRIVATE GOAL|Window functions|caller-jwt/)
    } finally { logs.mockRestore() }
  })
  it('can inspect latest work context using the second tool before final output', async () => {
    const detail = step([{ type: 'tool-call', toolCallId: 'detail', toolName: 'get_work_context', input: JSON.stringify({ planItemId: 'item' }) }], 'tool-calls')
    const f = fixture([snapshotStep(), detail, outputStep(existingProposal)])
    f.add('prep-sessions', 'last', { planItemId: 'item', state: 'ended', endedAt: '2026-10-01T13:00:00Z', startedAt: '2026-10-01T12:50:00Z', outcome: 'switched', leftOff: 'Duplicates', nextStep: 'Try [1,1,2]' })
    const response = await f.request()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ readTools: ['get_prep_snapshot', 'get_work_context'], display: [{ previouslyStarted: true }] })
    expect(f.model.doGenerateCalls).toHaveLength(3)
    expect(JSON.stringify(f.model.doGenerateCalls[2]?.prompt)).toContain('Try [1,1,2]')
  })
  it.each([401, 403, 503] as const)('honors access rejection %s before any model or record call', async (status) => {
    const f = fixture(); f.deny(status)
    expect((await f.request()).status).toBe(status)
    expect(createDeepSpaceAI).not.toHaveBeenCalled()
    expect(createUserToolExecutor).not.toHaveBeenCalled()
  })
  it('rejects caller identity parameters and empty Prep Areas before spending', async () => {
    const f = fixture()
    expect((await f.request({ availableMinutes: 30, userId: 'bob' })).status).toBe(400)
    f.tables.set('prep-areas', [])
    expect((await f.request()).status).toBe(409)
    expect(createDeepSpaceAI).not.toHaveBeenCalled()
  })
  it.each([
    { ...existingProposal, title: '' },
    { ...existingProposal, extra: true },
    { ...existingProposal, items: [{ ...existingProposal.items[0], estimatedMinutes: 31 }] },
    { ...existingProposal, items: [...existingProposal.items, ...existingProposal.items] },
    { ...existingProposal, items: [{ ...existingProposal.items[0], existingPlanItemId: 'foreign-item' }] },
    { ...existingProposal, items: [{ kind: 'new', prepAreaId: 'missing', intent: 'Invented', estimatedMinutes: 30, reason: 'Invented reference' }] },
  ])('rejects malformed, over-budget, duplicate or fabricated output without mutations: %j', async (proposal) => {
    const f = fixture([snapshotStep(), outputStep(proposal)]); const before = structuredClone(f.tables)
    expect((await f.request()).status).toBe(502)
    expect(f.tables).toEqual(before)
  })
  it('does not accept a model response that skipped real tool execution', async () => {
    const f = fixture([outputStep(existingProposal)])
    expect((await f.request()).status).toBe(502)
    expect(f.tables.get('plans')).toHaveLength(2)
  })
  it('rejects a valid recommendation after snapshot execution fails', async () => {
    const f = fixture()
    const execute = f.executor.getMockImplementation()!
    f.executor.mockImplementation(async (name, input) => {
      if (name === 'records.query' && input.collection === 'plans') return { success: false, error: 'Read denied' }
      return execute(name, input)
    })
    const before = structuredClone(f.tables)
    expect((await f.request()).status).toBe(502)
    expect(f.model.doGenerateCalls).toHaveLength(2)
    expect(f.tables).toEqual(before)
  })
  it('does not automatically retry a failed paid provider call', async () => {
    const f = fixture()
    const fail = vi.fn(async (): Promise<LanguageModelV4GenerateResult> => { throw new Error('Provider unavailable') })
    vi.mocked(createDeepSpaceAI).mockReturnValue(() => new MockLanguageModelV4({ doGenerate: fail }))
    expect((await f.request()).status).toBe(502)
    expect(fail).toHaveBeenCalledTimes(1)
    expect(f.executor.mock.calls.every(([name]) => name === 'records.get' || name === 'records.query')).toBe(true)
  })
})

it('provides relevant strategic context and active difficulty to the mocked model without writing', async () => {
  const f = fixture()
  f.add('prep-plans', 'strategy', { title: 'SQL Direction', goal: 'Improve SQL', context: 'Prioritize query reasoning.', prepAreaIds: ['area'], userId: 'alice', creationFingerprint: 'secret' })
  f.add('prep-plans', 'unrelated', { title: 'Design', goal: 'Design practice', context: 'Unrelated private strategy.', prepAreaIds: ['area'] })
  f.add('prep-sessions', 'active', { planItemId: 'item', intent: 'Window functions', state: 'active', startedAt: new Date().toISOString(), encounteredStuck: true })
  const before = structuredClone(f.tables)
  const response = await f.request({ availableMinutes: 30, goal: '  improve   SQL  ' })
  expect(response.status).toBe(200)
  const prompt = JSON.stringify(f.model.doGenerateCalls[1]!.prompt)
  expect(prompt).toContain('SQL Direction')
  expect(prompt).toContain('encounteredDifficulty')
  expect(prompt).not.toContain('Unrelated private strategy')
  expect(prompt).not.toContain('creationFingerprint')
  expect(f.tables).toEqual(before)
  expect(f.executor.mock.calls.every(([name]) => ['records.get', 'records.query'].includes(name))).toBe(true)
})
