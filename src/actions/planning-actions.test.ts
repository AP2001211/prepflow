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
  it('reuses existing work, creates only new work, preserves order and requested budget without estimates', async () => {
    const f = fixture(); const result = await f.call('acceptPrepPlan', input())
    expect(result.success).toBe(true)
    const planId = 'suggested-plan-alice-00000000-0000-4000-8000-000000000042'
    expect(f.row('plans', planId)?.data).toEqual({ title: 'Focused prep', budgetMinutes: 60, planItemIds: ['item', `${planId}-item-1`] })
    expect(f.row('plan-items', `${planId}-item-1`)?.data).toEqual({ prepAreaId: 'area', interviewId: 'interview', intent: 'Practice joins', status: 'open' })
    expect(f.row('plans', 'plan')?.data.planItemIds).toEqual(['item'])
    expect(f.create).toHaveBeenCalledTimes(2)
    expect(f.create.mock.calls.every(([collection]) => collection !== 'prep-sessions')).toBe(true)
    expect((await f.call('acceptPrepPlan', input())).success).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(2)
    const changed = input(); changed.recommendation.items[1]!.intent = 'Different work'
    expect((await f.call('acceptPrepPlan', changed)).success).toBe(false)
    expect(f.create).toHaveBeenCalledTimes(2)
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
    expect(plan?.data).toEqual({ planDate: daily().planDate, title: 'Today', budgetMinutes: 30, planItemIds: ['item'] })
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
      expect(f.create).toHaveBeenCalledTimes(1)
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
  it('allows another after completion without changing the first Plan and recovers its retry', async () => {
    const f = fixture()
    expect((await f.call('acceptPrepPlan', input(first))).success).toBe(true)
    const before = structuredClone(f.row('plans', `suggested-plan-alice-${first}`))
    const session = await f.start(`suggested-plan-alice-${first}`)
    expect(f.row('prep-sessions', session)?.data.planId).toBe(`suggested-plan-alice-${first}`)
    await f.stop(session, 'completed')
    f.put('plan-items', 'next', { prepAreaId: 'area', intent: 'Next', status: 'open' })
    expect((await f.call('acceptPrepPlan', input(second, 'next'))).success).toBe(true)
    expect(f.row('plans', `suggested-plan-alice-${first}`)).toEqual(before)
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
