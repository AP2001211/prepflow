import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import type { Plan } from '../schemas/prep-schema'
import { localPlanDate, todayPlans, validPlanDate, dailyPlanState, dailyPlanningAccess } from './plan-date'
const row = (id: string, data: Plan): RecordData<Plan> => ({ recordId: id, data, createdBy: 'alice', createdAt: '2026-10-02T12:00:00Z', updatedAt: '2026-10-02T12:00:00Z' })
describe('explicit local daily plans', () => {
  it('selects only exact dates, including completed/closed plans, never general or historical plans', () => {
    const daily = row('daily', { title: 'Done', planItemIds: ['completed'], planDate: '2026-10-02', closedAt: '2026-10-02T15:00:00Z' })
    const rows = [row('general', { title: 'Newest', planItemIds: [], startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-04T00:00:00Z' }), row('past', { title: 'Old', planItemIds: [], planDate: '2026-10-01' }), daily]
    expect(todayPlans(rows, '2026-10-02')).toEqual([daily])
    expect(todayPlans(rows, '2026-10-03')).toEqual([])
    expect(rows[2]?.data.planDate).toBe('2026-10-02')
  })
  it('uses local calendar dates across midnight and timezone changes', () => {
    const now = Date.parse('2026-10-03T02:00:00Z')
    expect(localPlanDate('America/Los_Angeles', now)).toBe('2026-10-02')
    expect(localPlanDate('Asia/Tokyo', now)).toBe('2026-10-03')
    expect(localPlanDate('America/New_York', Date.parse('2026-03-08T06:59:00Z'))).toBe('2026-03-08')
  })
  it('validates real dates without rollover or accepting empty values', () => {
    expect(validPlanDate('2028-02-29')).toBe(true)
    for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '', '10/02/2026']) expect(validPlanDate(date)).toBe(false)
    expect(() => localPlanDate('Invalid/Zone')).toThrow()
  })
})

describe('completion-aware daily selection', () => {
  const item = (id: string, status: 'open' | 'completed') => ({ recordId: id, createdBy: 'alice', createdAt: '', updatedAt: '', data: { intent: id, prepAreaId: 'area', status } })
  const plan = (id: string, ids: string[], date = '2026-10-02') => row(id, { title: id, planDate: date, planItemIds: ids })
  it('past unfinished work never blocks and completed Plans allow another', () => {
    expect(dailyPlanState([plan('past', ['open'], '2026-10-01')], [item('open', 'open')], '2026-10-02').planningAllowed).toBe(true)
    expect(dailyPlanState([plan('done', ['done'])], [item('done', 'completed')], '2026-10-02').planningAllowed).toBe(true)
  })
  it('selects the incomplete Plan alongside completed Plans and detects conflicts', () => {
    const plans = [plan('done', ['done']), plan('current', ['open'])]
    const items = [item('done', 'completed'), item('open', 'open')]
    expect(dailyPlanState(plans, items, '2026-10-02')).toMatchObject({ planningAllowed: false, currentPlan: { recordId: 'current' } })
    expect(dailyPlanState([...plans, plan('conflict', ['open'])], items, '2026-10-02')).toMatchObject({ conflict: true, planningAllowed: false, displayPlan: undefined })
  })
  it('orders completed fallback by creation time then ID without mutating input', () => {
    const plans = [plan('a', ['done']), plan('b', ['done'])]
    expect(dailyPlanState(plans, [item('done', 'completed')], '2026-10-02').displayPlan?.recordId).toBe('b')
    expect(plans.map((p) => p.recordId)).toEqual(['a', 'b'])
    plans[0]!.createdAt = '2026-10-02T14:00:00Z'
    expect(dailyPlanState(plans, [item('done', 'completed')], '2026-10-02').displayPlan?.recordId).toBe('a')
  })
  it('fails closed on missing/foreign membership and unloaded data', () => {
    const plans = [plan('today', ['missing'])]
    expect(dailyPlanState(plans, [], '2026-10-02').planningAllowed).toBe(false)
    expect(dailyPlanState(plans, [{ ...item('missing', 'completed'), createdBy: 'bob' }], '2026-10-02').planningAllowed).toBe(false)
    expect(dailyPlanState([], [], '2026-10-02', false).planningAllowed).toBe(false)
  })
  it('derives completed presentation collections without changing current selection', () => {
    const plans = [plan('a', ['done']), plan('b', ['done']), plan('current', ['open'])]
    const items = [item('done', 'completed'), item('open', 'open')]
    let state = dailyPlanState(plans, items, '2026-10-02')
    expect(state.displayPlan?.recordId).toBe('current')
    expect(state.completedPlans.map((p) => p.recordId)).toEqual(['b', 'a'])
    expect(state.completedEarlierPlans.map((p) => p.recordId)).toEqual(['b', 'a'])
    state = dailyPlanState(plans.slice(0, 2), items, '2026-10-02')
    expect(state.displayPlan?.recordId).toBe('b')
    expect(state.completedEarlierPlans.map((p) => p.recordId)).toEqual(['a'])
    expect(dailyPlanState(plans, items, '2026-10-02', false).completedEarlierPlans).toEqual([])
    const missing = dailyPlanState([plan('missing', ['absent'])], items, '2026-10-02')
    expect(missing.completedPlans).toEqual([])
    expect(missing.planningAllowed).toBe(false)
  })
})

describe('evolving daily planning access', () => {
  const date = '2026-10-02'
  const item = { recordId: 'item', createdBy: 'alice', createdAt: '', updatedAt: '', data: { intent: 'Work', prepAreaId: 'area', status: 'open' as const } }
  const plan = row('daily', { title: 'Daily', planDate: date, planItemIds: ['item'] })
  it('allows both incomplete and completed unclosed Plans', () => {
    expect(dailyPlanningAccess([plan], [item], date).planningAllowed).toBe(true)
    expect(dailyPlanningAccess([plan], [{ ...item, data: { ...item.data, status: 'completed' } }], date).planningAllowed).toBe(true)
  })
  it('blocks multiple records, explicit closure and unresolved membership', () => {
    expect(dailyPlanningAccess([plan, { ...plan, recordId: 'other' }], [item], date)).toMatchObject({ conflict: true, planningAllowed: false })
    expect(dailyPlanningAccess([{ ...plan, data: { ...plan.data, closedAt: '2026-10-02T12:00:00Z' } }], [item], date).planningAllowed).toBe(false)
    expect(dailyPlanningAccess([plan], [], date).planningAllowed).toBe(false)
    expect(dailyPlanningAccess([plan], [{ ...item, createdBy: 'bob' }], date).planningAllowed).toBe(false)
    expect(dailyPlanningAccess([], [], date, false).planningAllowed).toBe(false)
  })
})
