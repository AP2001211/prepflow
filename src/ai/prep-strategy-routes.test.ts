import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { createDeepSpaceAI, createUserToolExecutor } from 'deepspace/worker'
import type { AgentToolAccessResult } from 'deepspace/worker'
import type { AppContext } from '../../worker'
import { contextFixture } from './planner-test-fixture'
import { registerPrepStrategyRoutes } from './prep-strategy-routes'
import { PREP_STRATEGY_PROMPT, prepStrategyRequestSchema, validatePrepStrategy } from './prep-strategy-contract'

vi.mock('deepspace/worker', async (original) => ({ ...await original<typeof import('deepspace/worker')>(), createDeepSpaceAI: vi.fn(), createUserToolExecutor: vi.fn() }))
const proposal = { title: ' Clear interview preparation ', context: ' Emphasize explaining tradeoffs under interview conditions. ', existingPrepAreaIds: ['area'], suggestedPrepAreas: [] }
function fixture(output: unknown = proposal) {
  const data = contextFixture()
  data.add('interviews', 'interview', { company: 'Example', role: 'SWE', stage: 'Design', scheduledDate: '2026-10-20', notes: 'Discuss scale', prepAreaIds: ['area', 'foreign-area'] })
  const model = new MockLanguageModelV4({ doGenerate: async (): Promise<LanguageModelV4GenerateResult> => ({
    content: [{ type: 'text', text: JSON.stringify(output) }], finishReason: { unified: 'stop', raw: 'stop' }, warnings: [],
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
  }) })
  vi.mocked(createDeepSpaceAI).mockReturnValue(() => model)
  vi.mocked(createUserToolExecutor).mockReturnValue(data.executor)
  let access: AgentToolAccessResult = { ok: true, auth: { userId: 'alice', claims: { sub: 'alice' } } }
  const app = new Hono<AppContext>()
  registerPrepStrategyRoutes(app, async () => access)
  const request = (body: unknown = { interviewId: 'interview' }) => app.request('/api/ai/prep-strategy', { method: 'POST', headers: { Authorization: 'Bearer test-caller', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { APP_NAME: 'PrepFlow' })
  return { ...data, model, request, deny: (status: 401 | 403 | 503) => { access = { ok: false, status } } }
}
beforeEach(() => vi.clearAllMocks())
describe('strategic AI generation (real structured-output SDK, mocked provider)', () => {
  it('bounds Interview/area context and exposes only strategic reads, without writing anything', async () => {
    const f = fixture()
    f.tables.get('interviews')![0]!.data.notes = 'n'.repeat(3000)
    f.tables.get('prep-areas')![0]!.data.notes = 'a'.repeat(700)
    for (let i = 0; i < 40; i++) f.add('prep-areas', `extra-${i}`, { name: 'x'.repeat(300) })
    const before = structuredClone(f.tables)
    const response = await f.request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ proposal: { ...proposal, title: proposal.title.trim(), context: proposal.context.trim() } })
    const call = f.model.doGenerateCalls[0]!
    const content = call.prompt.find((message) => message.role === 'user')!
    if (content.role !== 'user' || content.content[0]?.type !== 'text') throw new Error('Missing grounded input')
    const input = JSON.parse(content.content[0].text)
    expect(input.interview).toMatchObject({ id: 'interview', company: 'Example', role: 'SWE', stage: 'Design', scheduledDate: '2026-10-20', prepAreaIds: ['area'] })
    expect(input.interview.notes).toHaveLength(2000)
    expect(input.prepAreas).toHaveLength(30)
    expect(input.prepAreas.every((area: { name: string; notes?: string }) => area.name.length <= 200 && (area.notes?.length ?? 0) <= 500)).toBe(true)
    expect(Object.keys(input).sort()).toEqual(['asOf', 'interview', 'prepAreas'])
    expect(call.tools ?? []).toHaveLength(0)
    expect(f.executor.mock.calls.every(([name, params]) => ['records.get', 'records.query'].includes(name) && ['interviews', 'prep-areas', 'prep-plans'].includes(String(params.collection)))).toBe(true)
    expect(f.tables).toEqual(before)
    expect(createDeepSpaceAI).toHaveBeenCalledWith(expect.anything(), expect.any(String), { authToken: 'test-caller' })
  })
  it('supports a goal with no Interview/Focus/work lookup and no Goal entity', async () => {
    const f = fixture()
    expect((await f.request({ goal: ' Improve design ' })).status).toBe(200)
    expect(JSON.stringify(f.model.doGenerateCalls[0]!.prompt)).toContain('Improve design')
    expect(f.executor.mock.calls).toHaveLength(1)
    expect(f.executor.mock.calls[0]![1].collection).toBe('prep-areas')
  })
  it.each([401, 403, 503] as const)('denies access %s before records/provider', async (status) => {
    const f = fixture(); f.deny(status)
    expect((await f.request()).status).toBe(status)
    expect(createUserToolExecutor).not.toHaveBeenCalled(); expect(createDeepSpaceAI).not.toHaveBeenCalled()
  })
  it.each([{}, { interviewId: 'interview', goal: 'Both' }, { goal: ' ' }, { goal: 'g'.repeat(501) }, { goal: 'Design', userId: 'bob' }])('rejects invalid/forged input %j before provider', async (input) => {
    const f = fixture(); expect((await f.request(input)).status).toBe(400); expect(createDeepSpaceAI).not.toHaveBeenCalled()
  })
  it('denies foreign Interview and prevents duplicate generation', async () => {
    const f = fixture(); f.add('interviews', 'foreign', { company: 'Other', prepAreaIds: [] }, 'bob')
    expect((await f.request({ interviewId: 'foreign' })).status).toBe(404)
    f.add('prep-plans', 'already', { interviewId: 'interview', userId: 'alice' })
    const response = await f.request()
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ existingPrepPlanId: 'already' })
    expect(createDeepSpaceAI).not.toHaveBeenCalled()
  })
  it.each([
    { ...proposal, title: '' }, { ...proposal, title: 't'.repeat(81) }, { ...proposal, context: ' ' }, { ...proposal, context: 'c'.repeat(2001) },
    { ...proposal, existingPrepAreaIds: ['invented'] }, { ...proposal, existingPrepAreaIds: ['foreign-area'] },
    { ...proposal, existingPrepAreaIds: Array(31).fill('area') }, { ...proposal, activities: ['Do work'] },
  ])('rejects invalid/invented/executable output without writes %j', async (output) => {
    const f = fixture(output); const before = structuredClone(f.tables)
    expect((await f.request()).status).toBe(502); expect(f.tables).toEqual(before)
  })
  it('deduplicates supplied area IDs in selection order', async () => {
    const f = fixture({ ...proposal, existingPrepAreaIds: ['area', 'area'] })
    expect(await (await f.request()).json()).toMatchObject({ proposal: { existingPrepAreaIds: ['area'], suggestedPrepAreas: [] } })
    expect(validatePrepStrategy(proposal, ['area']).title).toBe(proposal.title.trim())
  })
  it('allows an empty existing-area inventory without inventing categories', async () => {
    const f = fixture({ ...proposal, existingPrepAreaIds: [] }); f.tables.set('prep-areas', [])
    expect((await f.request({ goal: 'Design' })).status).toBe(200)
  })
  it('fails safely on read/provider failure and never automatically retries the provider', async () => {
    const f = fixture(); const before = structuredClone(f.tables)
    const fail = vi.fn(async (): Promise<LanguageModelV4GenerateResult> => { throw new Error('Provider unavailable') })
    vi.mocked(createDeepSpaceAI).mockReturnValue(() => new MockLanguageModelV4({ doGenerate: fail }))
    expect((await f.request()).status).toBe(502); expect(fail).toHaveBeenCalledTimes(1); expect(f.tables).toEqual(before)
    f.executor.mockResolvedValue({ success: false })
    expect((await f.request({ goal: 'Design' })).status).toBe(502); expect(fail).toHaveBeenCalledTimes(1)
  })
  it('keeps the strategic boundary and rejects executable/caller context', () => {
    expect(PREP_STRATEGY_PROMPT).toContain('NOT executable work or a roadmap')
    expect(PREP_STRATEGY_PROMPT).toContain('Do not claim knowledge')
    expect(PREP_STRATEGY_PROMPT).toContain('Never invent IDs')
    expect(prepStrategyRequestSchema.safeParse({ goal: 'Design', sessions: [] }).success).toBe(false)
  })
})

describe('suggested area proposal metadata', () => {
  it('canonicalizes normalized duplicates without converting names into IDs', () => {
    const result = validatePrepStrategy({ ...proposal, suggestedPrepAreas: [{ name: ' Quant  Math ' }, { name: 'quant math' }, { name: 'Mental Math' }] }, ['area'])
    expect(result.suggestedPrepAreas).toEqual([{ name: 'Quant  Math' }, { name: 'Mental Math' }])
    expect(result.existingPrepAreaIds).toEqual(['area'])
  })
  it.each([
    [{ name: '' }], [{ name: ' ' }], [{ name: 'x'.repeat(81) }], [{ name: 'Quant', notes: 'Unknown field' }],
    [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], ['Quant'],
  ].map((suggestedPrepAreas) => ({ suggestedPrepAreas })))('rejects malformed suggestions %j', ({ suggestedPrepAreas }) => {
    expect(() => validatePrepStrategy({ ...proposal, suggestedPrepAreas }, ['area'])).toThrow()
  })
  it('returns suggestions without creating areas or prep plans', async () => {
    const f = fixture({ ...proposal, suggestedPrepAreas: [{ name: 'Quant Math' }] })
    const before = structuredClone(f.tables)
    expect(await (await f.request({ goal: 'Improve quant math' })).json()).toMatchObject({ proposal: { suggestedPrepAreas: [{ name: 'Quant Math' }] } })
    expect(f.tables).toEqual(before)
  })
  it('requests short summary and broad categories without internal matching explanations', () => {
    for (const text of ['1–3 short sentences', '30–60 words', 'noun-phrase-like', 'None of your existing Prep Areas cover', 'broad reusable', 'micro-topic explosion', 'Never suggest Misc', 'NOT executable work']) expect(PREP_STRATEGY_PROMPT).toContain(text)
  })
})
