import { describe, expect, it, vi } from 'vitest'
import type { ActionContext, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { localPlanDate } from '../lib/plan-date'
import { acceptPrepPlan } from './planner-acceptance'
import { planningActions } from './planning-actions'

// Unit-test the action boundary, including accepted writes followed by failure.
// Runtime/API/browser tests separately exercise the real SDK and RBAC.
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
  const call = (name: keyof typeof planningActions | 'acceptPrepPlan', params: Record<string, unknown>, userId = 'alice') => (name === 'acceptPrepPlan' ? acceptPrepPlan : planningActions[name])({ userId, params, tools: { get, query, create, update } as unknown as ActionTools, env: { OWNER_USER_ID: 'owner' } as Env, callerJwt: 'unit-test' } satisfies ActionContext<Env>)
  const start = async (planId?: string) => {
    const result = await call('startPrepSession', { planItemId: 'item', ...(planId ? { planId } : {}) })
    expect(result.success).toBe(true)
    return (result as { data: { recordId: string } }).data.recordId
  }
  const stop = (sessionId: string, outcome: string, extra = {}) => call('endPrepSession', { sessionId, outcome, endedAt: new Date().toISOString(), ...extra })
  return { put, row, get, query, create, update, call, start, stop }
}

describe('Plans and immutable intended work', () => {
  it('creates a plan with optional bounds/budget and ordered empty membership', async () => {
    const f = fixture()
    expect((await f.call('createPlan', { title: ' My week ', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-08T00:00:00Z', budgetMinutes: 240 })).success).toBe(true)
    expect(f.create).toHaveBeenCalledWith('plans', { title: 'My week', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-08T00:00:00Z', budgetMinutes: 240, planItemIds: [] })
    expect((await f.call('createPlan', { title: 'No bounds' })).success).toBe(true)
  })
  it.each([{ title: '' }, { title: 'Test', budgetMinutes: 0 }, { title: 'Test', startsAt: '2026-10-08T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }, { title: 'Test', planItemIds: ['foreign'] }])('rejects invalid/forged plan input %j', async (input) => {
    const f = fixture(); expect((await f.call('createPlan', input)).success).toBe(false); expect(f.create).not.toHaveBeenCalled()
  })
  it('creates work linked to its owned area and optional interview/plan', async () => {
    const f = fixture()
    const result = await f.call('createPlanItem', { prepAreaId: 'area', interviewId: 'interview', intent: 'Practice joins', planId: 'plan' })
    expect(result.success).toBe(true)
    expect(f.create).toHaveBeenCalledWith('plan-items', { prepAreaId: 'area', interviewId: 'interview', intent: 'Practice joins', status: 'open' }, undefined)
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item', (result as { data: { recordId: string } }).data.recordId])
  })
  it('reuses the same open item in two plans without moving or duplicating it', async () => {
    const f = fixture(); f.put('plans', 'later', { title: 'Later', planItemIds: [] })
    expect((await f.call('addPlanItem', { planId: 'later', planItemId: 'item' })).success).toBe(true)
    expect((await f.call('addPlanItem', { planId: 'later', planItemId: 'item' })).success).toBe(true)
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item'])
    expect(f.row('plans', 'later')?.data.planItemIds).toEqual(['item'])
    expect(f.create).not.toHaveBeenCalled()
  })
  it('fixes closed membership and its close timestamp; unfinished work remains resumable outside it', async () => {
    const f = fixture()
    expect((await f.call('closePlan', { planId: 'plan' })).success).toBe(true)
    const closedAt = f.row('plans', 'plan')?.data.closedAt
    expect((await f.call('closePlan', { planId: 'plan' })).success).toBe(true)
    expect(f.row('plans', 'plan')?.data.closedAt).toBe(closedAt)
    f.put('plan-items', 'another', { prepAreaId: 'area', intent: 'Joins', status: 'open' })
    expect((await f.call('addPlanItem', { planId: 'plan', planItemId: 'another' })).success).toBe(false)
    expect((await f.call('createPlanItem', { planId: 'plan', prepAreaId: 'area', intent: 'Joins' })).success).toBe(false)
    expect((await f.call('startPrepSession', { planId: 'plan', planItemId: 'item' })).success).toBe(false)
    await f.start()
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item'])
  })
  it('requires planned starts to be members of that plan', async () => {
    const f = fixture(); f.put('plans', 'empty', { title: 'Empty', planItemIds: [] })
    expect((await f.call('startPrepSession', { planId: 'empty', planItemId: 'item' })).success).toBe(false)
    await f.start('plan')
    expect(f.create).toHaveBeenCalledWith('prep-sessions', expect.objectContaining({ planId: 'plan', planItemId: 'item', prepAreaId: 'area', intent: 'Window functions' }))
  })
  it('retries item creation after failed membership without duplicates or resetting completed work', async () => {
    const f = fixture(); const requestId = '00000000-0000-4000-8000-000000000001'
    const input = { prepAreaId: 'area', intent: 'Retryable work', planId: 'plan', requestId }
    f.update.mockResolvedValueOnce({ success: false, error: 'Offline' })
    expect((await f.call('createPlanItem', input)).success).toBe(false)
    expect((await f.call('createPlanItem', input)).success).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(1)
    const id = `item-alice-${requestId}`
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item', id])
    Object.assign(f.row('plan-items', id)!.data, { status: 'completed', completedAt: '2026-01-01T00:00:00Z' })
    expect((await f.call('createPlanItem', { ...input, planId: undefined })).success).toBe(true)
    expect(f.row('plan-items', id)?.data.status).toBe('completed')
    expect((await f.call('createPlanItem', { ...input, intent: 'Changed semantic identity' })).success).toBe(false)
  })
  it('fails closed if retry lookup fails, without upserting over an existing item', async () => {
    const f = fixture(); f.query.mockResolvedValueOnce({ success: false, error: 'Offline' } as never)
    expect((await f.call('createPlanItem', { prepAreaId: 'area', intent: 'Retry', requestId: '00000000-0000-4000-8000-000000000001' })).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
  })
})

describe('Continuous focus and checkpoints', () => {
  it('reports stuck without ending focus or changing item state', async () => {
    const f = fixture(); const id = await f.start(); const startedAt = f.row('prep-sessions', id)?.data.startedAt
    expect((await f.call('reportStuck', { sessionId: id, notes: 'Still trying' })).success).toBe(true)
    expect(f.row('prep-sessions', id)?.data).toMatchObject({ state: 'active', encounteredStuck: true, startedAt })
    expect(f.row('prep-sessions', id)?.data).not.toHaveProperty('endedAt')
    expect(f.row('plan-items', 'item')?.data.status).toBe('open')
  })
  it.each(['stopped', 'switched'])('%s leaves work open, resume creates a new interval for the same item', async (outcome) => {
    const f = fixture(); const first = await f.start('plan'); const original = structuredClone(f.row('prep-sessions', first)!.data)
    expect((await f.stop(first, outcome)).success).toBe(true)
    const endedAt = f.row('prep-sessions', first)?.data.endedAt
    expect(f.row('plan-items', 'item')?.data).toEqual({ prepAreaId: 'area', intent: 'Window functions', status: 'open' })
    const second = await f.start()
    expect(second).not.toBe(first)
    expect(f.row('prep-sessions', second)?.data).toMatchObject({ planItemId: 'item', state: 'active', prepAreaId: original.prepAreaId, intent: original.intent })
    expect(f.row('prep-sessions', first)?.data).toMatchObject({ state: 'ended', endedAt, outcome, planId: 'plan' })
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item'])
  })
  it('saves optional context afterward without extending endedAt; empty context is valid', async () => {
    const f = fixture(); const id = await f.start()
    expect((await f.call('saveResumeContext', { sessionId: id, leftOff: 'Too early' })).success).toBe(false)
    expect((await f.stop(id, 'switched')).success).toBe(true)
    const endedAt = f.row('prep-sessions', id)?.data.endedAt
    expect((await f.call('saveResumeContext', { sessionId: id, leftOff: 'Partition issue', nextStep: 'Try ROW_NUMBER' })).success).toBe(true)
    expect(f.row('prep-sessions', id)?.data).toMatchObject({ endedAt, leftOff: 'Partition issue', nextStep: 'Try ROW_NUMBER' })
    expect((await f.call('saveResumeContext', { sessionId: id, leftOff: '', nextStep: '' })).success).toBe(true)
    expect(f.row('prep-sessions', id)?.data).toMatchObject({ endedAt, leftOff: '', nextStep: '' })
  })
  it('guards normal starts and does not rewrite already-ended intervals on retries', async () => {
    const f = fixture(); const id = await f.start()
    expect((await f.call('startPrepSession', { planItemId: 'item' })).success).toBe(false)
    await f.stop(id, 'stopped'); const ended = structuredClone(f.row('prep-sessions', id)!.data)
    expect((await f.stop(id, 'stopped', { notes: 'Do not rewrite', leftOff: 'Do not rewrite' })).success).toBe(true)
    expect((await f.stop(id, 'completed')).success).toBe(false)
    expect((await f.call('reportStuck', { sessionId: id })).success).toBe(false)
    expect(f.row('prep-sessions', id)?.data).toEqual(ended)
  })
  it('rejects forged snapshots, owner, item state, time and session relationships', async () => {
    const f = fixture()
    for (const field of ['prepAreaId', 'interviewId', 'intent', 'createdBy', 'startedAt', 'state']) expect((await f.call('startPrepSession', { planItemId: 'item', [field]: 'forged' })).success).toBe(false)
    expect((await f.call('createPlanItem', { prepAreaId: 'area', intent: 'Work', status: 'completed' })).success).toBe(false)
    const id = await f.start()
    expect((await f.stop(id, 'switched', { planItemId: 'forged' })).success).toBe(false)
    expect((await f.stop(id, 'stopped', { endedAt: '2000-01-01T00:00:00Z' })).success).toBe(false)
    expect((await f.stop(id, 'stopped', { endedAt: '2100-01-01T00:00:00Z' })).success).toBe(false)
  })
})

describe('Completion acceptance, partial writes, and reconciliation', () => {
  it('ends first, completes the item at exactly the same timestamp, and rejects resume', async () => {
    const f = fixture(); const id = await f.start('plan'); const endedAt = new Date().toISOString()
    expect((await f.call('endPrepSession', { sessionId: id, outcome: 'completed', endedAt })).success).toBe(true)
    expect(f.update.mock.calls.slice(-2)).toEqual([['prep-sessions', id, { state: 'ended', outcome: 'completed', endedAt }], ['plan-items', 'item', { status: 'completed', completedAt: endedAt }]])
    expect((await f.call('startPrepSession', { planItemId: 'item' })).success).toBe(false)
    expect((await f.call('saveResumeContext', { sessionId: id, leftOff: 'Irrelevant' })).success).toBe(false)
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item'])
  })
  it('does not touch item completion when ending is rejected', async () => {
    const f = fixture(); const id = await f.start()
    f.update.mockResolvedValueOnce({ success: false, error: 'End rejected' })
    expect(await f.stop(id, 'completed')).toMatchObject({ success: false, error: 'End rejected' })
    expect(f.row('prep-sessions', id)?.data.state).toBe('active')
    expect(f.row('plan-items', 'item')?.data.status).toBe('open')
    expect(f.update).toHaveBeenCalledTimes(1)
  })
  it('retries an accepted session end whose response was lost, without rewriting the interval', async () => {
    const f = fixture(); const id = await f.start(); const update = f.update.getMockImplementation()!
    f.update.mockImplementationOnce(async (...args) => { await update(...args); throw new Error('End response lost') })
    const endedAt = new Date().toISOString()
    expect((await f.call('endPrepSession', { sessionId: id, outcome: 'completed', endedAt })).success).toBe(false)
    expect(f.row('prep-sessions', id)?.data).toMatchObject({ state: 'ended', endedAt, outcome: 'completed' })
    expect(f.row('plan-items', 'item')?.data.status).toBe('open')
    expect(await f.call('startPrepSession', { planItemId: 'item' })).toMatchObject({ success: false, code: 'completion_pending' })
    f.update.mockClear()
    expect((await f.stop(id, 'completed', { endedAt: '2000-01-01T00:00:00Z' })).success).toBe(true)
    expect(f.update.mock.calls).toEqual([['plan-items', 'item', { status: 'completed', completedAt: endedAt }]])
    expect(f.row('prep-sessions', id)?.data.endedAt).toBe(endedAt)
  })
  it.each(['rejected', 'thrown'])('keeps an accepted end when item update is %s, blocks resume, and reconciles safely', async (failure) => {
    const f = fixture(); const id = await f.start(); const update = f.update.getMockImplementation()!
    f.update.mockImplementation(async (collection, ...args) => {
      if (collection === 'plan-items') { if (failure === 'thrown') throw new Error('Offline'); return { success: false, error: 'Item rejected' } }
      return update(collection, ...args)
    })
    const endedAt = new Date().toISOString()
    expect(await f.call('endPrepSession', { sessionId: id, outcome: 'completed', endedAt })).toMatchObject({ success: false, code: 'completion_pending' })
    expect(f.row('prep-sessions', id)?.data).toMatchObject({ state: 'ended', outcome: 'completed', endedAt })
    expect(f.row('plan-items', 'item')?.data.status).toBe('open')
    expect(await f.call('startPrepSession', { planItemId: 'item' })).toMatchObject({ success: false, code: 'completion_pending' })
    expect((await f.call('addPlanItem', { planId: 'plan', planItemId: 'item' })).success).toBe(true) // Existing membership is preserved.
    f.update.mockImplementation(update); f.update.mockClear()
    expect((await f.call('reconcileCompletion', { sessionId: id })).success).toBe(true)
    expect(f.update.mock.calls).toEqual([['plan-items', 'item', { status: 'completed', completedAt: endedAt }]])
    expect((await f.call('reconcileCompletion', { sessionId: id })).success).toBe(true)
    expect((await f.stop(id, 'completed', { endedAt: '2000-01-01T00:00:00Z' })).success).toBe(true)
    expect(f.update).toHaveBeenCalledTimes(1)
    expect(f.row('prep-sessions', id)?.data.endedAt).toBe(endedAt)
  })
  it('handles an accepted item write whose response was lost without resetting timestamps', async () => {
    const f = fixture(); const id = await f.start(); const update = f.update.getMockImplementation()!
    f.update.mockImplementation(async (collection, ...args) => { const result = await update(collection, ...args); if (collection === 'plan-items') throw new Error('Response lost'); return result })
    expect(await f.stop(id, 'completed')).toMatchObject({ success: false, code: 'completion_pending' })
    const completedAt = f.row('plan-items', 'item')?.data.completedAt
    f.update.mockClear()
    expect((await f.call('reconcileCompletion', { sessionId: id })).success).toBe(true)
    expect(f.update).not.toHaveBeenCalled()
    expect(f.row('plan-items', 'item')?.data.completedAt).toBe(completedAt)
  })
  it('rejects reconciling an active or non-completed interval', async () => {
    const f = fixture(); const id = await f.start()
    expect((await f.call('reconcileCompletion', { sessionId: id })).success).toBe(false)
    await f.stop(id, 'stopped')
    expect((await f.call('reconcileCompletion', { sessionId: id })).success).toBe(false)
  })
})

describe('Cross-user relationships and roles', () => {
  it.each(['prep-areas', 'interviews', 'plans'])('rejects a foreign %s while creating intended work', async (collection) => {
    const f = fixture(); const id = { 'prep-areas': 'area', interviews: 'interview', plans: 'plan' }[collection]!
    f.row(collection, id)!.createdBy = 'bob'
    expect((await f.call('createPlanItem', { prepAreaId: 'area', interviewId: 'interview', intent: 'Work', planId: 'plan' })).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
  })
  it.each(['plans', 'plan-items'])('rejects foreign %s in membership and planned start', async (collection) => {
    const f = fixture(); f.row(collection, collection === 'plans' ? 'plan' : 'item')!.createdBy = 'bob'
    expect((await f.call('addPlanItem', { planId: 'plan', planItemId: 'item' })).success).toBe(false)
    expect((await f.call('startPrepSession', { planId: 'plan', planItemId: 'item' })).success).toBe(false)
    expect(f.update).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled()
  })
  it('rejects cross-user session actions and reconciliation even with a forged item relationship', async () => {
    const f = fixture(); const id = await f.start(); f.row('prep-sessions', id)!.createdBy = 'bob'
    for (const [name, params] of [['reportStuck', { sessionId: id }], ['saveResumeContext', { sessionId: id }], ['endPrepSession', { sessionId: id, outcome: 'completed', endedAt: new Date().toISOString() }], ['reconcileCompletion', { sessionId: id }]] as const) expect((await f.call(name, params)).success).toBe(false)
    f.row('prep-sessions', id)!.createdBy = 'alice'; Object.assign(f.row('prep-sessions', id)!.data, { state: 'ended', outcome: 'completed', endedAt: new Date().toISOString() }); f.row('plan-items', 'item')!.createdBy = 'bob'
    expect((await f.call('reconcileCompletion', { sessionId: id })).success).toBe(false)
    expect(f.update).not.toHaveBeenCalled()
  })
  it.each(['viewer', 'unknown'])('rejects %s on every privileged action', async (role) => {
    const f = fixture(); f.put('users', 'alice', { role })
    for (const name of Object.keys(planningActions) as (keyof typeof planningActions)[]) expect((await f.call(name, {})).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled()
  })
  it('rejects closing another user’s plan', async () => {
    const f = fixture(); f.row('plans', 'plan')!.createdBy = 'bob'
    expect((await f.call('closePlan', { planId: 'plan' })).success).toBe(false); expect(f.update).not.toHaveBeenCalled()
  })
})

describe('Reviewed planner acceptance (no model calls)', () => {
  const input = () => ({ requestId: '00000000-0000-4000-8000-000000000042', availableMinutes: 60, recommendation: {
    title: 'Focused prep', rationale: 'Use existing work, then practice joins', items: [
      { kind: 'existing', existingPlanItemId: 'item', estimatedMinutes: 30, reason: 'Continue' },
      { kind: 'new', prepAreaId: 'area', interviewId: 'interview', intent: 'Practice joins', estimatedMinutes: 20, reason: 'Relevant interview' },
    ],
  } })
  it('reuses existing work, creates only new work, preserves order and accepted allocation without per-item estimates', async () => {
    const f = fixture(); const result = await f.call('acceptPrepPlan', input())
    expect(result.success).toBe(true)
    const planId = 'suggested-plan-alice-00000000-0000-4000-8000-000000000042'
    expect(f.row('plans', planId)?.data).toEqual({ title: 'Focused prep', budgetMinutes: 50, planItemIds: ['item', `${planId}-item-1`] })
    expect(f.row('plan-items', `${planId}-item-1`)?.data).toEqual({ prepAreaId: 'area', interviewId: 'interview', intent: 'Practice joins', status: 'open' })
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item'])
    expect(f.create).toHaveBeenCalledTimes(3)
    expect(f.create.mock.calls.every(([collection]) => collection !== 'prep-sessions')).toBe(true)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(3)
    const changed = input(); changed.recommendation.items[1]!.intent = 'Different work'
    expect((await f.call('acceptPrepPlan', changed)).success).toBe(false)
    expect(f.create).toHaveBeenCalledTimes(3)
  })
  it.each(['completed', 'pending', 'foreign-item', 'foreign-area', 'foreign-interview', 'missing-area', 'missing-interview'])('rejects %s before writes', async (mode) => {
    const f = fixture()
    if (mode === 'completed') f.put('plan-items', 'item', { prepAreaId: 'area', intent: 'Window functions', status: 'completed' })
    if (mode === 'pending') f.put('prep-sessions', 'pending', { planItemId: 'item', state: 'ended', outcome: 'completed' })
    if (mode === 'foreign-item') f.put('plan-items', 'item', { prepAreaId: 'area', intent: 'Window functions', status: 'open' }, 'bob')
    if (mode === 'foreign-area') f.put('prep-areas', 'area', { name: 'SQL' }, 'bob')
    if (mode === 'foreign-interview') f.put('interviews', 'interview', { company: 'Other' }, 'bob')
    const data = input()
    if (mode === 'missing-area') data.recommendation.items[1]!.prepAreaId = 'missing'
    if (mode === 'missing-interview') data.recommendation.items[1]!.interviewId = 'missing'
    expect((await f.call('acceptPrepPlan', data)).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
  })
  it('rejects duplicate references, over-budget proposals and cross-user acceptance', async () => {
    const f = fixture()
    const duplicate = input(); duplicate.recommendation.items = [duplicate.recommendation.items[0]!, duplicate.recommendation.items[0]!]
    expect((await f.call('acceptPrepPlan', duplicate)).success).toBe(false)
    expect((await f.call('acceptPrepPlan', { ...input(), availableMinutes: 20 })).success).toBe(false)
    f.put('users', 'bob', { role: 'member' }, 'bob')
    expect((await f.call('acceptPrepPlan', input(), 'bob')).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
  })
  it('reuses a saved new item after the plan write fails, without resetting it', async () => {
    const f = fixture(); const original = f.create.getMockImplementation()!
    let fail = true
    f.create.mockImplementation(async (collection, data, id) => {
      if (collection === 'plans' && fail) { fail = false; throw new Error('Unavailable') }
      return original(collection, data, id)
    })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create.mock.calls.filter(([collection]) => collection === 'plan-items')).toHaveLength(1)
  })
})

describe('daily plan lifecycle', () => {
  const daily = () => ({ planDate: localPlanDate('America/New_York'), timeZone: 'America/New_York' })
  const input = (requestId = '00000000-0000-4000-8000-000000000070') => ({ requestId, availableMinutes: 30, daily: daily(), recommendation: { title: 'Today', rationale: 'Focus', items: [{ kind: 'existing', existingPlanItemId: 'item', estimatedMinutes: 30, reason: 'Continue' }] } })
  it('persists the explicit date, keeps original membership and rejects a second submission before writes', async () => {
    const f = fixture(); expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    const plan = f.row('plans', 'suggested-plan-alice-00000000-0000-4000-8000-000000000070')
    expect(plan?.data).toEqual({ planDate: daily().planDate, title: 'Today', budgetMinutes: 30, planItemIds: ['item'], appliedAcceptanceIds: ['acceptance-alice-00000000-0000-4000-8000-000000000070'] })
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item'])
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    const before = f.create.mock.calls.length
    expect((await f.call('acceptPrepPlan', input('00000000-0000-4000-8000-000000000071'))).success).toBe(false)
    expect(f.create).toHaveBeenCalledTimes(before)
    expect(f.row('plan-items', 'item')?.data.status).toBe('open')
  })
  it('allows another user the same date with their own work', async () => {
    const f = fixture(); await f.call('acceptPrepPlan', input())
    f.put('users', 'bob', { role: 'member' }, 'bob'); f.put('prep-areas', 'bob-area', { name: 'SQL' }, 'bob'); f.put('plan-items', 'bob-item', { intent: 'SQL', prepAreaId: 'bob-area', status: 'open' }, 'bob')
    const data = input(); data.recommendation.items[0]!.existingPlanItemId = 'bob-item'
    expect((await f.call('acceptPrepPlan', data, 'bob')).success).toBe(true)
  })
  it('never recovers an undated record for a dated submission or downgrades a dated retry to generic', async () => {
    const f = fixture()
    const data = input()
    const id = `suggested-plan-alice-${data.requestId}`
    f.put('plans', id, { title: data.recommendation.title, budgetMinutes: data.availableMinutes, planItemIds: ['item'] })
    expect((await f.call('acceptPrepPlan', data)).success).toBe(false)
    expect(f.row('plans', id)?.data.planDate).toBeUndefined()
    expect(f.create).not.toHaveBeenCalled()
    const dated = fixture()
    expect((await dated.call('acceptPrepPlan', data)).success).toBe(true)
    const { daily: _daily, ...generic } = data
    void _daily
    expect((await dated.call('acceptPrepPlan', generic)).success).toBe(false)
    expect(dated.row('plans', id)?.data.planDate).toBe(data.daily.planDate)
  })
  it('rejects invalid dates, zones, stale daily context and changed retry date before writes', async () => {
    const f = fixture()
    for (const value of [{ planDate: '2026-02-30', timeZone: 'UTC' }, { planDate: daily().planDate, timeZone: 'Not/AZone' }, { planDate: '2000-01-01', timeZone: 'UTC' }]) expect((await f.call('acceptPrepPlan', { ...input(), daily: value })).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
    await f.call('acceptPrepPlan', input())
    expect((await f.call('acceptPrepPlan', { ...input(), daily: { planDate: '2000-01-01', timeZone: 'UTC' } })).success).toBe(false)
  })
  it('protects daily membership through both generic add paths before creating work, without closing it', async () => {
    const f = fixture(); f.put('plans', 'daily', { title: 'Past day', planDate: '2000-01-01', planItemIds: ['item'] })
    expect((await f.call('addPlanItem', { planId: 'daily', planItemId: 'item' })).success).toBe(false)
    expect((await f.call('createPlanItem', { planId: 'daily', prepAreaId: 'area', intent: 'Unplanned addition' })).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
    expect(f.row('plans', 'daily')?.data.closedAt).toBeUndefined()
    const session = await f.start()
    await f.stop(session, 'switched')
    expect(f.row('plan-items', 'item')?.data.status).toBe('open')
    expect(f.row('plans', 'daily')?.data.planItemIds).toEqual(['item'])
    await f.start() // Historical daily membership never blocks unplanned resume.
  })
})

describe('daily retries across midnight', () => {
  it('reads back an accepted submission after the date changes, without retimestamping or duplicating', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-02T12:00:00Z'))
      const f = fixture()
      const input = { requestId: '00000000-0000-4000-8000-000000000080', availableMinutes: 30, daily: { planDate: '2026-10-02', timeZone: 'UTC' }, recommendation: { title: 'Today', rationale: 'Focus', items: [{ kind: 'existing', existingPlanItemId: 'item', estimatedMinutes: 30, reason: 'Continue' }] } }
      expect((await f.call('acceptPrepPlan', input)).success).toBe(true)
      vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
      expect((await f.call('acceptPrepPlan', input)).success).toBe(true)
      expect(f.create).toHaveBeenCalledTimes(2)
      expect(f.row('plans', 'suggested-plan-alice-00000000-0000-4000-8000-000000000080')?.data.planDate).toBe('2026-10-02')
    } finally { vi.useRealTimers() }
  })
})

it('autosaves owned active notes, preserves final notes, and starts resumed notes empty', async () => {
  const f = fixture()
  const sessionId = await f.start()
  const notes = '  Working notebook\n\n'
  expect((await f.call('saveSessionNotes', { sessionId, notes })).success).toBe(true)
  expect(f.row('prep-sessions', sessionId)?.data.notes).toBe(notes)
  expect((await f.call('saveSessionNotes', { sessionId, notes: 'forged' }, 'bob')).success).toBe(false)
  await f.call('reportStuck', { sessionId })
  expect(f.row('prep-sessions', sessionId)?.data.notes).toBe(notes)
  await f.stop(sessionId, 'stopped', { notes: 'final notebook' })
  expect(f.row('prep-sessions', sessionId)?.data.notes).toBe('final notebook')
  expect((await f.call('saveSessionNotes', { sessionId, notes: 'late' })).success).toBe(false)
  const resumed = await f.start()
  expect(f.row('prep-sessions', resumed)?.data.notes).toBeUndefined()
  expect(f.row('prep-sessions', sessionId)?.data.notes).toBe('final notebook')
})

it('snapshots instructions on start/resume without populating notebook or checkpoint', async () => {
  const f = fixture()
  f.row('plan-items', 'item')!.data.instructions = 'Explain edge cases'
  const first = await f.start()
  expect(f.row('prep-sessions', first)?.data).toMatchObject({ instructions: 'Explain edge cases' })
  await f.stop(first, 'stopped', { notes: 'Working notes', leftOff: 'Checkpoint' })
  const resumed = await f.start()
  expect(resumed).not.toBe(first)
  const data = f.row('prep-sessions', resumed)!.data
  expect(data.instructions).toBe('Explain edge cases')
  for (const field of ['notes', 'leftOff', 'nextStep']) expect(data[field]).toBeUndefined()
})
it.each([false, true])('acceptance retry compares instructions after partial/full persistence (%s)', async (partial) => {
  const f = fixture()
  const input = { requestId: '00000000-0000-4000-8000-000000000099', availableMinutes: 30, recommendation: { title: 'Practice', rationale: 'Interview', items: [{ kind: 'new', prepAreaId: 'area', intent: 'Course Schedule II', instructions: 'Explain edge cases', estimatedMinutes: 30, reason: 'Practice' }] } }
  const original = f.create.getMockImplementation()!
  let fail = partial
  f.create.mockImplementation(async (collection, data, id) => {
    if (collection === 'plans' && fail) { fail = false; throw new Error('Unavailable') }
    return original(collection, data, id)
  })
  expect((await f.call('acceptPrepPlan', input)).success).toBe(!partial)
  const id = 'suggested-plan-alice-00000000-0000-4000-8000-000000000099-item-0'
  expect(f.row('plan-items', id)?.data.instructions).toBe('Explain edge cases')
  const changed = structuredClone(input); changed.recommendation.items[0]!.instructions = 'Different instructions'
  expect((await f.call('acceptPrepPlan', changed)).success).toBe(false)
  expect((await f.call('acceptPrepPlan', input)).success).toBe(true)
  expect(f.create.mock.calls.filter(([collection]) => collection === 'plan-items')).toHaveLength(1)
})

describe('sequential daily Plans', () => {
  const input = (id: string, item = 'item') => ({ requestId: id, availableMinutes: 30, daily: { planDate: localPlanDate('UTC'), timeZone: 'UTC' }, recommendation: { title: 'Today', rationale: 'Focus', items: [{ kind: 'existing', existingPlanItemId: item, estimatedMinutes: 30, reason: 'Continue' }] } })
  const first = '00000000-0000-4000-8000-000000000101'
  const second = '00000000-0000-4000-8000-000000000102'
  it('extends the same completed Plan and recovers earlier acceptance independently', async () => {
    const f = fixture()
    expect((await f.call('acceptPrepPlan', input(first))).success).toBe(true)
    const session = await f.start(`suggested-plan-alice-${first}`)
    expect(f.row('prep-sessions', session)?.data.planId).toBe(`suggested-plan-alice-${first}`)
    await f.stop(session, 'completed')
    f.put('plan-items', 'next', { prepAreaId: 'area', intent: 'Next', status: 'open' })
    expect((await f.call('acceptPrepPlan', input(second, 'next'))).success).toBe(true)
    expect(f.row('plans', `suggested-plan-alice-${first}`)?.data).toMatchObject({ planItemIds: ['item', 'next'], budgetMinutes: 60 })
    expect(f.row('plans', `suggested-plan-alice-${second}`)).toBeUndefined()
    expect(f.row('plan-items', 'item')?.data.status).toBe('completed')
    expect((await f.call('acceptPrepPlan', input(first))).success).toBe(true)
    expect((await f.call('acceptPrepPlan', input('00000000-0000-4000-8000-000000000103', 'next'))).success).toBe(false)
  })
  it('past incomplete membership remains reusable', async () => {
    const f = fixture(); f.put('plans', 'yesterday', { title: 'Past', planDate: '2000-01-01', planItemIds: ['item'] })
    expect((await f.call('acceptPrepPlan', input(first))).success).toBe(true)
    expect(f.row('plans', 'yesterday')?.data.planItemIds).toEqual(['item'])
    expect(f.row('plans', `suggested-plan-alice-${first}`)?.data.planItemIds).toEqual(['item'])
  })
  it.each(['missing', 'foreign', 'pending', 'conflict', 'partial-read'])('blocks %s state before writes', async (mode) => {
    const f = fixture(); f.put('plans', 'today', { title: 'Today', planDate: localPlanDate('UTC'), planItemIds: [mode === 'missing' ? 'missing' : 'item'] })
    if (mode === 'foreign') f.row('plan-items', 'item')!.createdBy = 'bob'
    if (mode === 'pending') f.put('prep-sessions', 'pending', { planItemId: 'item', state: 'ended', outcome: 'completed' })
    if (mode === 'conflict') f.put('plans', 'other', { title: 'Other', planDate: localPlanDate('UTC'), planItemIds: ['item'] })
    if (mode === 'partial-read') {
      const original = f.query.getMockImplementation()!
      f.query.mockImplementation(async (collection, options) => { const result = await original(collection, options); return options.where?.planDate ? { ...result, data: { ...result.data, count: 501 } } : result })
    }
    const result = await f.call('acceptPrepPlan', input(first))
    expect(result.success).toBe(false)
    if (mode === 'conflict') expect(result).toMatchObject({ code: 'daily_plan_conflict' })
    expect(f.create).not.toHaveBeenCalled()
  })
})

it('acknowledges only owned active focus using server time and changes no lifecycle evidence', async () => {
  const f = fixture()
  const id = await f.start()
  Object.assign(f.row('prep-sessions', id)!.data, { notes: 'Notebook', encounteredStuck: true, leftOff: 'Context', nextStep: 'Next' })
  const before = structuredClone(f.row('prep-sessions', id)!.data)
  const serverNow = new Date('2026-10-04T15:32:00Z')
  vi.spyOn(Date, 'now').mockReturnValue(serverNow.getTime())
  vi.useFakeTimers(); vi.setSystemTime(serverNow)
  try {
    expect((await f.call('acknowledgeFocusCheckIn', { sessionId: id, lastCheckInAt: 'forged' })).success).toBe(false)
    expect((await f.call('acknowledgeFocusCheckIn', { sessionId: id })).success).toBe(true)
    expect(f.row('prep-sessions', id)!.data).toEqual({ ...before, lastCheckInAt: serverNow.toISOString() })
    expect(f.update).toHaveBeenLastCalledWith('prep-sessions', id, { lastCheckInAt: serverNow.toISOString() })
    f.put('prep-sessions', 'foreign', { ...before }, 'bob')
    expect((await f.call('acknowledgeFocusCheckIn', { sessionId: 'foreign' })).success).toBe(false)
    f.put('prep-sessions', 'ended', { ...before, state: 'ended', outcome: 'stopped' })
    expect((await f.call('acknowledgeFocusCheckIn', { sessionId: 'ended' })).success).toBe(false)
  } finally { vi.useRealTimers(); vi.restoreAllMocks() }
})

describe('switch context', () => {
  it('persists a bounded switch reason and breadcrumb without changing difficulty, notes or end time', async () => {
    const f = fixture(); const id = await f.start()
    await f.stop(id, 'switched', { notes: 'final notebook' })
    const before = structuredClone(f.row('prep-sessions', id)!.data)
    expect((await f.call('saveResumeContext', { sessionId: id, switchReason: 'stuck', leftOff: 'edge case', nextStep: 'test it' })).success).toBe(true)
    expect(f.row('prep-sessions', id)!.data).toEqual({ ...before, switchReason: 'stuck', leftOff: 'edge case', nextStep: 'test it' })
    expect(before.encounteredStuck).toBe(false)
    expect((await f.call('saveResumeContext', { sessionId: id, switchReason: 'invented' })).success).toBe(false)
    expect((await f.call('saveResumeContext', { sessionId: id, switchReason: 'break' }, 'bob')).success).toBe(false)
  })
  it('rejects reasons on active and stopped sessions; ordinary stopped context still works', async () => {
    const f = fixture(); const id = await f.start()
    expect((await f.call('saveResumeContext', { sessionId: id, switchReason: 'break' })).success).toBe(false)
    await f.stop(id, 'stopped')
    expect((await f.call('saveResumeContext', { sessionId: id, switchReason: 'break' })).success).toBe(false)
    expect((await f.call('saveResumeContext', { sessionId: id, leftOff: 'still valid' })).success).toBe(true)
  })
})

describe('future daily acceptance', () => {
  const input = (id = '00000000-0000-4000-8000-000000000090') => ({ requestId: id, availableMinutes: 30, daily: { planDate: '2099-01-01', timeZone: 'UTC' }, recommendation: { title: 'Future', rationale: 'Focus', items: [{ kind: 'existing', existingPlanItemId: 'item', estimatedMinutes: 30, reason: 'Continue' }] } })
  it('persists target despite today’s incomplete plan and rejects sequential incomplete target', async () => {
    const f = fixture(); f.put('plans', 'today', { title: 'Today', planDate: localPlanDate('UTC'), planItemIds: ['item'] })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.row('plans', `suggested-plan-alice-${input().requestId}`)?.data.planDate).toBe('2099-01-01')
    expect((await f.call('acceptPrepPlan', input('00000000-0000-4000-8000-000000000091'))).success).toBe(false)
  })
  it('allows completed target history and fails safely on missing target membership or conflict', async () => {
    const f = fixture(); f.put('plan-items', 'done', { status: 'completed', prepAreaId: 'area', intent: 'Done' })
    f.put('plans', 'completed', { title: 'Completed', planDate: '2099-01-01', planItemIds: ['done'] })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    for (const mode of ['missing', 'conflict']) {
      const g = fixture(); g.put('plans', 'target', { title: 'Target', planDate: '2099-01-01', planItemIds: [mode === 'missing' ? 'missing' : 'item'] })
      if (mode === 'conflict') g.put('plans', 'target2', { title: 'Target2', planDate: '2099-01-01', planItemIds: ['item'] })
      expect((await g.call('acceptPrepPlan', input())).success).toBe(false)
      expect(g.create).not.toHaveBeenCalled()
    }
  })
})

it('recovers a future accepted submission after the target passes but rejects new acceptance', async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z'))
    const f = fixture()
    const data = { requestId: '00000000-0000-4000-8000-000000000092', availableMinutes: 30, daily: { planDate: '2027-01-01', timeZone: 'UTC' }, recommendation: { title: 'Future', rationale: 'Focus', items: [{ kind: 'existing', existingPlanItemId: 'item', estimatedMinutes: 30, reason: 'Continue' }] } }
    expect((await f.call('acceptPrepPlan', data)).success).toBe(true)
    vi.setSystemTime(new Date('2027-01-02T12:00:00Z'))
    expect((await f.call('acceptPrepPlan', data)).success).toBe(true)
    expect((await f.call('acceptPrepPlan', { ...data, requestId: '00000000-0000-4000-8000-000000000093' })).success).toBe(false)
  } finally { vi.useRealTimers() }
})

describe('daily-created work availability', () => {
  const input = (daily = true) => ({ requestId: '00000000-0000-4000-8000-000000000095', availableMinutes: 60, ...(daily ? { daily: { planDate: '2099-01-01', timeZone: 'UTC' } } : {}), recommendation: { title: 'Future block', rationale: 'Focus', items: [
    { kind: 'existing', existingPlanItemId: 'item', estimatedMinutes: 30, reason: 'Continue' },
    { kind: 'new', prepAreaId: 'area', intent: 'New work', instructions: 'Execution brief', estimatedMinutes: 30, reason: 'Practice' },
  ] } })
  const newId = 'suggested-plan-alice-00000000-0000-4000-8000-000000000095-item-1'
  it.each([undefined, '2026-01-01'])('sets new daily availability without rewriting existing availability %s', async (availableFrom) => {
    const f = fixture(); if (availableFrom) f.row('plan-items', 'item')!.data.availableFrom = availableFrom
    const before = structuredClone(f.row('plan-items', 'item'))
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.row('plan-items', newId)?.data.availableFrom).toBe('2099-01-01')
    expect(f.row('plan-items', 'item')).toEqual(before)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create.mock.calls.filter(([c]) => c === 'plan-items')).toHaveLength(1)
    f.row('plan-items', newId)!.data.availableFrom = '2099-01-02'
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
  })
  it('generic acceptance does not invent an availability date', async () => {
    const f = fixture(); expect((await f.call('acceptPrepPlan', input(false))).success).toBe(true)
    expect(f.row('plan-items', newId)?.data.availableFrom).toBeUndefined()
  })
  it('retains exact availability through partial writes and lost Plan responses', async () => {
    const f = fixture(); const create = f.create.getMockImplementation()!
    let fail = true
    f.create.mockImplementation(async (collection, values, id) => { if (collection === 'plans' && fail) { fail = false; throw new Error('Unavailable') }; return create(collection, values, id) })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    expect(f.row('plan-items', newId)?.data.availableFrom).toBe('2099-01-01')
    f.create.mockImplementation(async (collection, values, id) => { const result = await create(collection, values, id); if (collection === 'plans') throw new Error('Response lost'); return result })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create.mock.calls.filter(([c]) => c === 'plan-items')).toHaveLength(1)
  })
  it('blocks forged automatic reuse before availability without restricting explicit early start/resume', async () => {
    const f = fixture(); f.row('plan-items', 'item')!.data.availableFrom = '2099-01-02'
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
    const start = await f.call('startPrepSession', { planItemId: 'item', planId: 'plan' })
    expect(start.success).toBe(true)
    const id = (start as { data: { recordId: string } }).data.recordId
    expect((await f.call('endPrepSession', { sessionId: id, outcome: 'stopped', endedAt: new Date().toISOString(), leftOff: 'Early checkpoint' })).success).toBe(true)
    const resume = await f.call('startPrepSession', { planItemId: 'item' })
    expect(resume.success).toBe(true)
    expect((resume as { data: { recordId: string } }).data.recordId).not.toBe(id)
    expect(f.row('prep-sessions', id)?.data.leftOff).toBe('Early checkpoint')
    expect(f.row('plan-items', 'item')?.data.availableFrom).toBe('2099-01-02')
  })
  it('recovers accepted legacy daily work without assigning availability retroactively', async () => {
    const f = fixture(); await f.call('acceptPrepPlan', input())
    delete f.row('plan-items', newId)!.data.availableFrom
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.row('plan-items', newId)?.data.availableFrom).toBeUndefined()
  })
})


describe('Selective acceptance receipts', () => {
  const id = '00000000-0000-4000-8000-000000000099'
  const input = (selectedIndices: number[] = [0, 2]) => ({ requestId: id, selectedIndices, availableMinutes: 60, recommendation: { title: 'Selected work', rationale: 'Practice', items: [25, 25, 10].map((estimatedMinutes, i) => ({ kind: 'new', intent: `Work ${i}`, prepAreaId: 'area', estimatedMinutes, reason: 'Practice' })) } })
  it.each([[], [0, 0], [-1], [3], [1.5]].map((indices) => ({ indices })))('rejects invalid selection %j before writes', async ({ indices }) => {
    const f = fixture(); expect((await f.call('acceptPrepPlan', input(indices))).success).toBe(false); expect(f.create).not.toHaveBeenCalled()
  })
  it('sorts original positions, creates only selected work and recovers independently of later membership/budget', async () => {
    const f = fixture(); const planId = `suggested-plan-alice-${id}`
    expect((await f.call('acceptPrepPlan', input([2, 0]))).success).toBe(true)
    expect(f.row('plans', planId)?.data).toMatchObject({ budgetMinutes: 35, planItemIds: [`${planId}-item-0`, `${planId}-item-2`] })
    expect(f.row('plan-items', `${planId}-item-1`)).toBeUndefined()
    expect(f.row('plan-acceptances', `acceptance-alice-${id}`)?.data).toMatchObject({ state: 'applied', selectedIndices: [0, 2], acceptedMinutes: 35 })
    f.row('plans', planId)!.data.planItemIds = [`${planId}-item-0`, `${planId}-item-2`, 'item']
    f.row('plans', planId)!.data.budgetMinutes = 80
    const writes = f.create.mock.calls.length
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(writes)
    expect((await f.call('acceptPrepPlan', input([0, 1, 2]))).success).toBe(false)
  })
  it('reuses only selected canonical existing work and ignores unselected foreign references', async () => {
    const f = fixture(); const original = structuredClone(f.row('plan-items', 'item')!.data)
    const data = input([0]); data.recommendation.items = [{ kind: 'existing', existingPlanItemId: 'item', estimatedMinutes: 25, reason: 'Continue' }, { kind: 'existing', existingPlanItemId: 'foreign', estimatedMinutes: 25, reason: 'Unselected' }] as never
    expect((await f.call('acceptPrepPlan', data)).success).toBe(true)
    expect(f.row('plans', `suggested-plan-alice-${id}`)?.data.planItemIds).toEqual(['item'])
    expect(f.row('plan-items', 'item')!.data).toEqual(original)
    expect(f.create.mock.calls.filter(([collection]) => collection === 'plan-items')).toHaveLength(0)
  })
  it('recovers after one selected item was saved and rejects changed partial selection', async () => {
    const f = fixture(); const create = f.create.getMockImplementation()!; let failed = false
    f.create.mockImplementation(async (...args) => { if (!failed && args[2]?.endsWith('item-2')) { failed = true; return { success: false, error: 'Injected' } as never } return create(...args) })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    expect((await f.call('acceptPrepPlan', input([0, 1]))).success).toBe(false)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create.mock.calls.filter(([, , recordId]) => recordId?.endsWith('item-0'))).toHaveLength(1)
  })
  it('recovers an applied receipt after the final response was lost', async () => {
    const f = fixture(); const update = f.update.getMockImplementation()!; let failed = false
    f.update.mockImplementation(async (...args) => { const result = await update(...args); if (!failed && args[0] === 'plan-acceptances') { failed = true; throw new Error('Lost response') } return result })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    const writes = f.create.mock.calls.length
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(writes)
  })
  it('persists accepted rather than requested allocation', async () => {
    const f = fixture(); await f.call('acceptPrepPlan', input([0, 1])); expect(f.row('plans', `suggested-plan-alice-${id}`)?.data.budgetMinutes).toBe(50)
  })
  it.each(['plan-items', 'plans', 'finalization'])('recovers failure at %s without duplicates', async (stage) => {
    const f = fixture(); const create = f.create.getMockImplementation()!; const update = f.update.getMockImplementation()!; let failed = false
    f.create.mockImplementation(async (...args) => { if (!failed && args[0] === stage) { failed = true; return { success: false, error: 'Injected' } as never } return create(...args) })
    f.update.mockImplementation(async (...args) => { if (!failed && stage === 'finalization') { failed = true; return { success: false, error: 'Injected' } as never } return update(...args) })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create.mock.calls.filter(([c]) => c === 'plan-items').filter(([, , itemId]) => itemId?.endsWith('item-1'))).toHaveLength(0)
    expect(f.row('plans', `suggested-plan-alice-${id}`)?.data.budgetMinutes).toBe(35)
  })
})


describe('evolving daily acceptance', () => {
  const requestId = '00000000-0000-4000-8000-000000000200'
  const input = () => ({ requestId, selectedIndices: [2, 0], availableMinutes: 60, daily: { planDate: '2099-01-01', timeZone: 'UTC' }, recommendation: { title: 'Additional work', rationale: 'More practice', items: [20, 20, 20].map((estimatedMinutes, index) => ({ kind: 'new', intent: `Additional ${index}`, prepAreaId: 'area', estimatedMinutes, reason: 'Practice' })) } })
  it('rejects selected existing membership before any materialization or allocation change', async () => {
    const f = fixture(); f.put('plans', 'daily', { planDate: '2099-01-01', title: 'Original', planItemIds: ['item'], budgetMinutes: 50 })
    const before = structuredClone(f.row('plans', 'daily'))
    const data = { ...input(), selectedIndices: [0], recommendation: { title: 'More', rationale: 'Practice', items: [{ kind: 'existing', existingPlanItemId: 'item', estimatedMinutes: 20, reason: 'Continue' }] } }
    expect(await f.call('acceptPrepPlan', data)).toMatchObject({ success: false, error: expect.stringContaining('already represented') })
    expect(f.create).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled(); expect(f.row('plans', 'daily')).toEqual(before)
  })
  it.each(['open', 'completed'])('extends a legacy %s Plan without reconstructing its original receipt', async (status) => {
    const f = fixture(); f.row('plan-items', 'item')!.data.status = status
    f.put('plans', 'daily', { planDate: '2099-01-01', title: 'Original', planItemIds: ['item'], budgetMinutes: 50 })
    const originalItem = structuredClone(f.row('plan-items', 'item'))
    const result = await f.call('acceptPrepPlan', input()); expect(result).toMatchObject({ success: true, data: { recordId: 'daily' } })
    const namespace = `suggested-plan-alice-${requestId}`
    expect(f.row('plans', 'daily')?.data).toMatchObject({ title: 'Original', planDate: '2099-01-01', planItemIds: ['item', `${namespace}-item-0`, `${namespace}-item-2`], budgetMinutes: 90 })
    expect(f.row('plan-items', 'item')).toEqual(originalItem)
    expect(f.row('plan-items', `${namespace}-item-1`)).toBeUndefined()
    expect(f.row('plan-items', `${namespace}-item-2`)?.data.availableFrom).toBe('2099-01-01')
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.row('plans', 'daily')?.data.budgetMinutes).toBe(90)
    expect(f.create.mock.calls.filter(([collection]) => collection === 'plans')).toHaveLength(0)
    expect(f.create.mock.calls.filter(([collection]) => collection === 'plan-acceptances')).toHaveLength(1)
  })
  it.each(['closed', 'multiple', 'missing', 'foreign'])('rejects %s before writes', async (mode) => {
    const f = fixture(); f.put('plans', 'daily', { planDate: '2099-01-01', title: 'Original', planItemIds: ['item'], budgetMinutes: 50, ...(mode === 'closed' ? { closedAt: '2026-10-01T12:00:00Z' } : {}) })
    if (mode === 'multiple') f.put('plans', 'other', { planDate: '2099-01-01', title: 'Other', planItemIds: [] })
    if (mode === 'missing') f.row('plans', 'daily')!.data.planItemIds = ['missing']
    if (mode === 'foreign') f.row('plan-items', 'item')!.createdBy = 'bob'
    const before = structuredClone(f.row('plans', 'daily'))
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled(); expect(f.row('plans', 'daily')).toEqual(before)
  })
  it.each(['before-append', 'lost-append-response', 'finalization'])('recovers %s exactly once', async (failure) => {
    const f = fixture(); f.put('plans', 'daily', { planDate: '2099-01-01', title: 'Original', planItemIds: ['item'], budgetMinutes: 50 })
    const update = f.update.getMockImplementation()!; let failed = false
    f.update.mockImplementation(async (...args) => {
      if (!failed && ((failure === 'finalization' && args[0] === 'plan-acceptances') || (failure !== 'finalization' && args[0] === 'plans'))) {
        failed = true
        if (failure === 'lost-append-response') { await update(...args); throw new Error('Lost response') }
        return { success: false, error: 'Injected' } as never
      }
      return update(...args)
    })
    expect((await f.call('acceptPrepPlan', input())).success).toBe(false)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.row('plans', 'daily')?.data.budgetMinutes).toBe(90)
    expect((f.row('plans', 'daily')?.data.planItemIds as string[])).toHaveLength(3)
    expect(f.row('plans', 'daily')?.data.appliedAcceptanceIds).toEqual([`acceptance-alice-${requestId}`])
  })
})

it('recovers both independent receipts after 50 + 40 minutes without reverting either contribution', async () => {
  const f = fixture()
  const make = (suffix: string, minutes: number) => ({ requestId: `00000000-0000-4000-8000-000000000${suffix}`, availableMinutes: minutes * 2, daily: { planDate: '2099-02-01', timeZone: 'UTC' }, recommendation: { title: 'Daily work', rationale: 'Practice', items: [0, 1].map((index) => ({ kind: 'new', intent: `${suffix} Work ${index}`, prepAreaId: 'area', estimatedMinutes: minutes, reason: 'Practice' })) } })
  const first = make('301', 25), second = make('302', 20)
  const result = await f.call('acceptPrepPlan', first)
  expect(result.success).toBe(true)
  const planId = `suggested-plan-alice-${first.requestId}`
  expect(await f.call('acceptPrepPlan', second)).toMatchObject({ success: true, data: { recordId: planId } })
  const after = structuredClone(f.row('plans', planId))
  expect(after?.data.budgetMinutes).toBe(90)
  expect(after?.data.planItemIds).toHaveLength(4)
  expect((await f.call('acceptPrepPlan', first)).success).toBe(true)
  expect((await f.call('acceptPrepPlan', second)).success).toBe(true)
  expect(f.row('plans', planId)).toEqual(after)
})

it('evolves completed membership from 3/3 through 3/5 to 5/5 using normal Focus completion', async () => {
  const f = fixture()
  for (const id of ['item', 'old2', 'old3']) f.put('plan-items', id, { prepAreaId: 'area', intent: id, status: 'completed', completedAt: '2026-10-01T12:00:00Z' })
  f.put('plans', 'daily', { title: 'Original', planDate: '2099-02-01', planItemIds: ['item', 'old2', 'old3'], budgetMinutes: 50 })
  const requestId = '00000000-0000-4000-8000-000000000303'
  expect((await f.call('acceptPrepPlan', { requestId, availableMinutes: 40, daily: { planDate: '2099-02-01', timeZone: 'UTC' }, recommendation: { title: 'More', rationale: 'Practice', items: [0, 1].map((i) => ({ kind: 'new', intent: `Next ${i}`, prepAreaId: 'area', estimatedMinutes: 20, reason: 'Practice' })) } })).success).toBe(true)
  const members = f.row('plans', 'daily')!.data.planItemIds as string[]
  expect(members).toHaveLength(5)
  expect(members.filter((id) => f.row('plan-items', id)?.data.status === 'completed')).toHaveLength(3)
  for (const planItemId of members.slice(3)) {
    const start = await f.call('startPrepSession', { planItemId, planId: 'daily' })
    expect(start.success).toBe(true)
    const id = (start as { data: { recordId: string } }).data.recordId
    expect((await f.stop(id, 'completed')).success).toBe(true)
  }
  expect(members.every((id) => f.row('plan-items', id)?.data.status === 'completed')).toBe(true)
  expect(f.row('plan-items', 'item')?.data.completedAt).toBe('2026-10-01T12:00:00Z')
})

it('finalizes an earlier pending receipt after a later append without changing either contribution', async () => {
  const f = fixture()
  const make = (suffix: string) => ({ requestId: `00000000-0000-4000-8000-000000000${suffix}`, availableMinutes: 20, daily: { planDate: '2099-02-01', timeZone: 'UTC' }, recommendation: { title: 'Daily work', rationale: 'Practice', items: [{ kind: 'new', intent: `Work ${suffix}`, prepAreaId: 'area', estimatedMinutes: 20, reason: 'Practice' }] } })
  const first = make('304'), second = make('305')
  const update = f.update.getMockImplementation()!
  let fail = true
  f.update.mockImplementation(async (...args) => {
    if (fail && args[0] === 'plan-acceptances') { fail = false; return { success: false, error: 'Injected finalization failure' } as never }
    return update(...args)
  })
  expect((await f.call('acceptPrepPlan', first)).success).toBe(false)
  expect((await f.call('acceptPrepPlan', second)).success).toBe(true)
  const planId = `suggested-plan-alice-${first.requestId}`
  const before = structuredClone(f.row('plans', planId))
  expect(before?.data.budgetMinutes).toBe(40)
  expect((await f.call('acceptPrepPlan', first)).success).toBe(true)
  expect(f.row('plans', planId)).toEqual(before)
  expect(f.row('plan-acceptances', `acceptance-alice-${first.requestId}`)?.data.state).toBe('applied')
})

it('recovers a partially materialized creation after another submission creates the canonical date Plan', async () => {
  const f = fixture()
  const make = (suffix: string) => ({ requestId: `00000000-0000-4000-8000-000000000${suffix}`, availableMinutes: 20, daily: { planDate: '2099-02-01', timeZone: 'UTC' }, recommendation: { title: 'Daily work', rationale: 'Practice', items: [{ kind: 'new', intent: `Work ${suffix}`, prepAreaId: 'area', estimatedMinutes: 20, reason: 'Practice' }] } })
  const first = make('306'), second = make('307')
  const create = f.create.getMockImplementation()!; let fail = true
  f.create.mockImplementation(async (...args) => {
    if (fail && args[0] === 'plans') { fail = false; return { success: false, error: 'Injected creation failure' } as never }
    return create(...args)
  })
  expect((await f.call('acceptPrepPlan', first)).success).toBe(false)
  const canonicalId = `suggested-plan-alice-${second.requestId}`
  expect(await f.call('acceptPrepPlan', second)).toMatchObject({ success: true, data: { recordId: canonicalId } })
  expect(await f.call('acceptPrepPlan', first)).toMatchObject({ success: true, data: { recordId: canonicalId } })
  expect((await f.call('acceptPrepPlan', first)).success).toBe(true)
  expect(f.row('plans', canonicalId)?.data.budgetMinutes).toBe(40)
  expect(f.row('plans', canonicalId)?.data.planItemIds).toHaveLength(2)
  expect(f.row('plans', `suggested-plan-alice-${first.requestId}`)).toBeUndefined()
  expect(f.row('plan-acceptances', `acceptance-alice-${first.requestId}`)?.data.planId).toBe(canonicalId)
})

it('preserves a historical long Plan title and old-proposal retry when adding later suggestions', async () => {
  const f = fixture()
  const original = { requestId: '00000000-0000-4000-8000-000000000400', availableMinutes: 20, daily: { planDate: '2099-03-01', timeZone: 'UTC' }, recommendation: { title: 'Historical name '.repeat(10), rationale: 'Practice', items: [{ kind: 'new', intent: 'Original practice', prepAreaId: 'area', estimatedMinutes: 20, reason: 'Practice' }] } }
  expect((await f.call('acceptPrepPlan', original)).success).toBe(true)
  const planId = `suggested-plan-alice-${original.requestId}`
  const more = { ...original, requestId: '00000000-0000-4000-8000-000000000401', recommendation: { ...original.recommendation, title: 'Short New Name', items: [{ ...original.recommendation.items[0], intent: 'Additional practice' }] } }
  expect((await f.call('acceptPrepPlan', more)).success).toBe(true)
  expect(f.row('plans', planId)?.data.title).toBe(original.recommendation.title.trim())
  expect((await f.call('acceptPrepPlan', original)).success).toBe(true)
  expect(f.row('plans', planId)?.data.budgetMinutes).toBe(40)
})

it.each(['stopped', 'switched', 'completed'])('difficulty survives %s while a new unfinished interval resets it', async (outcome) => {
  const f = fixture(); const id = await f.start()
  await f.call('reportStuck', { sessionId: id, notes: 'Working through difficulty' })
  await f.call('reportStuck', { sessionId: id })
  expect(f.row('prep-sessions', id)!.data.state).toBe('active')
  expect(f.row('prep-sessions', id)!.data.outcome).toBeUndefined()
  expect(f.row('plan-items', 'item')!.data.status).toBe('open')
  await f.stop(id, outcome)
  expect(f.row('prep-sessions', id)!.data).toMatchObject({ encounteredStuck: true, state: 'ended', outcome })
  if (outcome === 'completed') expect(f.row('plan-items', 'item')!.data.status).toBe('completed')
  else {
    const resumed = await f.start()
    expect(f.row('prep-sessions', resumed)!.data.encounteredStuck).toBe(false)
  }
})
