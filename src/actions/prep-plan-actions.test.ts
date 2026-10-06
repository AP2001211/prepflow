import { describe, expect, it, vi } from 'vitest'
import type { ActionContext, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { createPrepPlan, updatePrepPlan } from './prep-plan-actions'
function fixture() {
  type Row = { recordId: string; createdBy: string; data: Record<string, unknown> }
  const tables = new Map<string, Map<string, Row>>()
  let sequence = 0
  function put(collection: string, recordId: string, data: Record<string, unknown>, createdBy = 'alice') {
    if (!tables.has(collection)) tables.set(collection, new Map())
    tables.get(collection)!.set(recordId, { recordId, createdBy, data: { ...data } })
  }
  const row = (collection: string, id: string) => tables.get(collection)?.get(id)
  const get = vi.fn(async (collection: string, id: string) => {
    const record = row(collection, id)
    return record ? { success: true, data: { record: structuredClone(record) } } : { success: false, error: 'Not found' }
  })
  const query = vi.fn(async (collection: string, options: { where?: Record<string, unknown>; limit?: number }) => {
    const records = [...(tables.get(collection)?.values() ?? [])].filter((record) => Object.entries(options.where ?? {}).every(([key, value]) => (key === 'createdBy' || key === 'recordId' ? record[key] : record.data[key]) === value))
    return { success: true, data: { records: structuredClone(records.slice(0, options.limit ?? records.length)), count: records.length } }
  })
  const create = vi.fn(async (collection: string, data: Record<string, unknown>, id?: string) => {
    const recordId = id ?? `new-${++sequence}`
    put(collection, recordId, data)
    return { success: true, data: { recordId } }
  })
  const update = vi.fn(async (collection: string, id: string, data: Record<string, unknown>) => {
    const record = row(collection, id)
    if (!record) return { success: false, error: 'Not found' }
    Object.assign(record.data, data)
    return { success: true, data: { recordId: id } }
  })
  put('users', 'alice', { role: 'member' })
  put('prep-areas', 'area', { name: 'SQL' })
  put('interviews', 'interview', { company: 'Example', prepAreaIds: ['area'] })
  put('plan-items', 'item', { prepAreaId: 'area', intent: 'Window functions', status: 'open' })
  put('plans', 'plan', { title: 'A week of prep', planItemIds: ['item'] })
  const call = (name: 'createPrepPlan' | 'updatePrepPlan', params: Record<string, unknown>, userId = 'alice') => (name === 'createPrepPlan' ? createPrepPlan : updatePrepPlan)({ userId, params, tools: { get, query, create, update } as unknown as ActionTools, env: { OWNER_USER_ID: 'owner' } as Env, callerJwt: 'unit-test' } satisfies ActionContext<Env>)
  return { put, row, get, query, create, update, call }
}


const requestId = '00000000-0000-4000-8000-000000000001'
const input = { requestId, title: ' Interview preparation ', context: ' Practice tradeoffs ', interviewId: 'interview', prepAreaIds: ['area', 'area'] }
describe('strategic Prep Plan actions', () => {
  it('creates only context, canonically deduplicates, and binds ownership', async () => {
    const f = fixture(); const result = await f.call('createPrepPlan', input)
    expect(result.success).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.create).toHaveBeenCalledWith('prep-plans', expect.objectContaining({ title: 'Interview preparation', context: 'Practice tradeoffs', userId: 'alice', interviewId: 'interview', prepAreaIds: ['area'] }), expect.any(String))
    expect(f.update).not.toHaveBeenCalled()
    expect(f.create.mock.calls[0]![1]).not.toHaveProperty('planItemIds')
  })
  it('permits multiple goal plans without materializing an empty Interview anchor', async () => {
    const f = fixture(); const { interviewId: _anchor, ...base } = input
    expect((await f.call('createPrepPlan', { ...base, goal: ' Improve design ' })).success).toBe(true)
    expect((await f.call('createPrepPlan', { ...base, requestId: '00000000-0000-4000-8000-000000000002', goal: 'Coding' })).success).toBe(true)
    for (const call of f.create.mock.calls) expect(call[1]).not.toHaveProperty('interviewId')
  })
  it.each([
    { interviewId: undefined }, { goal: 'Both' }, { interviewId: '' }, { interviewId: 'foreign' },
    { prepAreaIds: ['foreign'] }, { title: '' }, { title: 'x'.repeat(81) }, { context: '' },
    { context: 'x'.repeat(2001) }, { interviewId: 'x'.repeat(201) }, { prepAreaIds: Array(31).fill('area') },
    { interviewId: undefined, goal: ' ' }, { interviewId: undefined, goal: 'x'.repeat(501) },
    { userId: 'bob' }, { planItemIds: ['item'] }, { budgetMinutes: 60 },
  ])('rejects invalid, foreign or executable input %j before writing', async (extra) => {
    const f = fixture(); expect((await f.call('createPrepPlan', { ...input, ...extra })).success).toBe(false); expect(f.create).not.toHaveBeenCalled()
  })
  it('rejects foreign existing references and callers without write permission', async () => {
    const f = fixture(); f.put('interviews', 'foreign', { company: 'Other' }, 'bob'); f.put('prep-areas', 'foreign-area', { name: 'Other' }, 'bob')
    expect((await f.call('createPrepPlan', { ...input, interviewId: 'foreign' })).success).toBe(false)
    expect((await f.call('createPrepPlan', { ...input, prepAreaIds: ['foreign-area'] })).success).toBe(false)
    expect((await f.call('createPrepPlan', input, 'viewer')).success).toBe(false)
  })
  it('recovers lost responses and an original creation even after later edits', async () => {
    const f = fixture(); const created = await f.call('createPrepPlan', input) as { data: { recordId: string } }
    f.create.mockClear()
    expect(await f.call('createPrepPlan', input)).toEqual(created)
    expect((await f.call('updatePrepPlan', { prepPlanId: created.data.recordId, title: 'Updated', context: 'New context', prepAreaIds: [] })).success).toBe(true)
    expect(await f.call('createPrepPlan', input)).toEqual(created)
    expect(f.create).not.toHaveBeenCalled()
    expect((await f.call('createPrepPlan', { ...input, title: 'Changed submission' })).success).toBe(false)
  })
  it('recovers a committed creation when the response throws, without a second write', async () => {
    const f = fixture()
    const original = f.create.getMockImplementation()!
    f.create.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Lost response') })
    expect((await f.call('createPrepPlan', input)).success).toBe(false)
    expect((await f.call('createPrepPlan', input)).success).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(1)
  })
  it('prevents a second Interview plan without overwriting its context', async () => {
    const f = fixture(); await f.call('createPrepPlan', input)
    expect((await f.call('createPrepPlan', { ...input, requestId: '00000000-0000-4000-8000-000000000002' })).success).toBe(false)
    expect(f.create).toHaveBeenCalledTimes(1)
  })
  it('updates only owned strategic fields and keeps the Interview anchor immutable', async () => {
    const f = fixture(); f.put('prep-plans', 'prep', { interviewId: 'interview', title: 'Old', context: 'Old', prepAreaIds: [] })
    const update = { prepPlanId: 'prep', title: 'New', context: 'Updated', prepAreaIds: ['area', 'area'] }
    expect((await f.call('updatePrepPlan', update, 'bob')).success).toBe(false)
    expect((await f.call('updatePrepPlan', { ...update, interviewId: 'interview' })).success).toBe(false)
    expect((await f.call('updatePrepPlan', { ...update, goal: 'Reanchor' })).success).toBe(false)
    expect((await f.call('updatePrepPlan', { ...update, prepAreaIds: ['foreign'] })).success).toBe(false)
    expect((await f.call('updatePrepPlan', update)).success).toBe(true)
    expect(f.update).toHaveBeenLastCalledWith('prep-plans', 'prep', { title: 'New', context: 'Updated', prepAreaIds: ['area'] })
    expect(f.row('prep-plans', 'prep')!.data.interviewId).toBe('interview')
  })
  it('allows goal edits but never switches anchor type or loses the goal', async () => {
    const f = fixture(); f.put('prep-plans', 'goal', { goal: 'Old', title: 'Old', context: 'Old', prepAreaIds: [] })
    const data = { prepPlanId: 'goal', title: 'New', context: 'Updated', prepAreaIds: [] }
    expect((await f.call('updatePrepPlan', data)).success).toBe(false)
    expect((await f.call('updatePrepPlan', { ...data, goal: 'New goal' })).success).toBe(true)
    expect(f.row('prep-plans', 'goal')!.data.goal).toBe('New goal')
  })
})
