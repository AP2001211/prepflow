import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import type { Plan, PlanItem, PrepSession } from '../schemas/prep-schema'
import { itemMemberships, relevantPlan, unfinishedWork } from './plans'
const now = Date.parse('2026-10-02T12:00:00Z')
const plan = (recordId: string, data: Partial<Plan> = {}, createdAt = '2026-10-01T00:00:00Z') => ({ recordId, createdAt, createdBy: 'alice', data: { title: recordId, planItemIds: [], ...data } }) as RecordData<Plan>
const active = (planId?: string) => ({ recordId: 'active', data: { planId, state: 'active' } }) as RecordData<PrepSession>
describe('Relevant plan display selection', () => {
  it('prefers the focus plan, including one closed during its interval', () => {
    const focused = plan('focus', { closedAt: '2026-10-02T10:00:00Z' })
    expect(relevantPlan([plan('other'), focused], [active('focus')], now)).toBe(focused)
  })
  it('prefers covering bounds over upcoming or recently created plans', () => {
    const current = plan('current', { startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-03T00:00:00Z' })
    expect(relevantPlan([plan('newest', {}, '2026-10-02T11:00:00Z'), plan('future', { startsAt: '2026-10-04T00:00:00Z' }), current], [], now)).toBe(current)
  })
  it('accepts one-sided bounds and treats the end as exclusive', () => {
    const ended = plan('ended', { endsAt: '2026-10-02T12:00:00Z' })
    const started = plan('started', { startsAt: '2026-10-01T00:00:00Z' })
    expect(relevantPlan([ended, started], [], now)).toBe(started)
  })
  it('chooses the nearest upcoming plan, then newest open plan', () => {
    const next = plan('next', { startsAt: '2026-10-03T00:00:00Z' })
    expect(relevantPlan([plan('later', { startsAt: '2026-10-04T00:00:00Z' }), plan('undated'), next], [], now)).toBe(next)
    const newest = plan('newest', {}, '2026-10-02T00:00:00Z')
    expect(relevantPlan([newest, plan('older')], [], now)).toBe(newest)
  })
  it('excludes closed plans and does not arbitrarily choose a conflicting focus plan', () => {
    expect(relevantPlan([plan('closed', { closedAt: '2026-10-01T00:00:00Z' })], [], now)).toBeUndefined()
    const newest = plan('newest', {}, '2026-10-02T00:00:00Z')
    expect(relevantPlan([plan('a'), plan('b'), newest], [active('a'), active('b')], now)).toBe(newest)
  })
  it('finds shared membership without changing either original plan', () => {
    const original = plan('original', { planItemIds: ['shared', 'other'], closedAt: '2026-10-01T00:00:00Z' })
    const later = plan('later', { planItemIds: ['shared'] })
    expect(itemMemberships([original, later], 'shared')).toEqual([original, later])
    expect(original.data.planItemIds).toEqual(['shared', 'other'])
    expect(later.data.planItemIds).toEqual(['shared'])
  })
})


describe('Unfinished Work identity list', () => {
  it('includes open work across zero, one, many and closed plan memberships once', () => {
    const work = (recordId: string, status = 'open') => ({ recordId, data: { prepAreaId: 'area', intent: recordId, status } }) as RecordData<PlanItem>
    const items = [work('outside'), work('one'), work('shared'), work('closed'), work('done', 'completed')]
    const plans = [plan('original', { planItemIds: ['one', 'shared'] }), plan('later', { planItemIds: ['shared'] }), plan('closedPlan', { planItemIds: ['closed'], closedAt: '2026-10-01T00:00:00Z' })]
    expect(unfinishedWork([...items, items[2]!]).map((item) => item.recordId)).toEqual(['outside', 'one', 'shared', 'closed'])
    expect(itemMemberships(plans, 'shared').map((row) => row.recordId)).toEqual(['original', 'later'])
    expect(plans[0]!.data.planItemIds).toEqual(['one', 'shared'])
  })
})
