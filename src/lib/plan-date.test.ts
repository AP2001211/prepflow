import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import type { Plan } from '../schemas/prep-schema'
import { localPlanDate, todayPlans, validPlanDate } from './plan-date'
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
