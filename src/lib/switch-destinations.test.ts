import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import type { Plan, PlanItem, PrepSession } from '../schemas/prep-schema'
import { continueItems } from './focus'
import { switchDestinations, switchFocusDuration } from './switch-destinations'
const item = (recordId: string, status = 'open') => ({ recordId, createdBy: 'alice', data: { status, intent: recordId } }) as RecordData<PlanItem>
const session = (planItemId: string, extra = {}) => ({ recordId: `${planItemId}-session`, data: { planItemId, state: 'ended', outcome: 'switched', startedAt: '2026-10-04T12:00:00Z', endedAt: '2026-10-04T12:30:00Z', leftOff: 'breadcrumb', nextStep: 'next', ...extra } }) as RecordData<PrepSession>
const plan = (planItemIds: string[]) => ({ recordId: 'plan', data: { planItemIds } }) as RecordData<Plan>
describe('Switch-only destinations', () => {
  it('excludes source from both groups, prefers Pick Back Up, and keeps canonical ordering', () => {
    const items = [item('source'), item('resume'), item('new'), item('done', 'completed')]
    const sessions = [session('source'), session('resume')]
    const result = switchDestinations('source', items, sessions, plan(['source', 'resume', 'new', 'done', 'new']))
    expect(result.resume.map(({ item }) => item.recordId)).toEqual(['resume'])
    expect(result.planned.map((item) => item.recordId)).toEqual(['new'])
    expect(result.resume[0].interval.data.nextStep).toBe('next')
    // Home uses the original eligibility unchanged and still offers source.
    expect(continueItems(items, sessions).map(({ item }) => item.recordId)).toContain('source')
  })
  it('filters source before bounding the compact resume list', () => {
    const items = ['source', 'one', 'two', 'three', 'four'].map((id) => item(id))
    const sessions = items.map((row, index) => session(row.recordId, { endedAt: new Date(Date.parse('2026-10-04T13:00:00Z') - index * 60000).toISOString() }))
    const result = switchDestinations('source', items, sessions)
    expect(result.resume.map(({ item }) => item.recordId)).toEqual(['one', 'two', 'three'])
  })
  it('excludes source even when it is only in the Plan, and ignores missing work safely', () => {
    expect(switchDestinations('source', [item('source'), item('next')], [], plan(['missing', 'source', 'next'])).planned.map((item) => item.recordId)).toEqual(['next'])
  })
  it('does not rewrite item, session or membership data', () => {
    const items = [item('source'), item('next')]; const sessions = [session('source')]; const current = plan(['source', 'next'])
    const before = JSON.stringify({ items, sessions, current })
    switchDestinations('source', items, sessions, current)
    expect(JSON.stringify({ items, sessions, current })).toBe(before)
  })
})
describe('Switch elapsed display only', () => {
  it.each([1, 30000, 59999])('shows < 1 min for %i positive milliseconds', (ms) => {
    expect(switchFocusDuration(session('source', { endedAt: new Date(Date.parse('2026-10-04T12:00:00Z') + ms).toISOString() }).data)).toBe('< 1 min focused')
  })
  it('preserves zero, minute and invalid timestamp handling', () => {
    expect(switchFocusDuration(session('source', { endedAt: '2026-10-04T12:00:00Z' }).data)).toBe('0 min focused')
    expect(switchFocusDuration(session('source', { endedAt: '2026-10-04T12:01:00Z' }).data)).toBe('1 min focused')
    expect(switchFocusDuration(session('source', { endedAt: 'invalid' }).data)).toBe('0 min focused')
  })
})
