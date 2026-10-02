import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import type { PlanItem, PrepSession } from '../schemas/prep-schema'
import { continueItems, dailyFocusMs, intervalFocusMs, itemFocusMs, itemStatusAt, latestEndedIntervals, reportingDayBounds, precedingInterval } from './focus'

const item = (recordId: string, status: 'open' | 'completed' = 'open') => ({ recordId, createdBy: 'alice', data: { prepAreaId: 'area', intent: recordId, status } }) as RecordData<PlanItem>
function interval(recordId: string, planItemId: string, startedAt: string, endedAt?: string, extra: Partial<PrepSession> = {}): RecordData<PrepSession> {
  return { recordId, createdBy: 'alice', data: { planItemId, prepAreaId: 'area', intent: 'Work', startedAt, ...(endedAt ? { endedAt } : {}), state: endedAt ? 'ended' : 'active', outcome: endedAt ? 'switched' : undefined, encounteredStuck: false, ...extra } } as RecordData<PrepSession>
}

describe('Focus duration from continuous intervals', () => {
  const records = [
    interval('a', 'work', '2026-10-01T14:00:00Z', '2026-10-01T14:10:00Z'),
    interval('b', 'work', '2026-10-01T16:00:00Z', '2026-10-01T16:20:00Z'),
    interval('c', 'work', '2026-10-02T10:00:00Z', '2026-10-02T10:30:00Z', { outcome: 'completed' }),
  ]
  it('sums actual focus, excluding gaps between attempts and other items', () => {
    expect(intervalFocusMs(records[0]!.data)).toBe(10 * 60000)
    expect(itemFocusMs([...records, interval('other', 'other', '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z')], 'work')).toBe(60 * 60000)
    expect(dailyFocusMs(records, '2026-10-01', 'UTC')).toBe(30 * 60000)
    expect(dailyFocusMs(records, '2026-10-02', 'UTC')).toBe(30 * 60000)
  })
  it('splits an interval at local midnight without double counting', () => {
    const crossing = [interval('midnight', 'work', '2026-10-02T03:50:00Z', '2026-10-02T04:20:00Z')]
    expect(dailyFocusMs(crossing, '2026-10-01', 'America/New_York')).toBe(10 * 60000)
    expect(dailyFocusMs(crossing, '2026-10-02', 'America/New_York')).toBe(20 * 60000)
    expect(itemFocusMs(crossing, 'work')).toBe(30 * 60000)
  })
  it.each([['2026-03-08', 23], ['2026-11-01', 25]])('uses actual %s reporting boundaries during DST (%s hours)', (day, hours) => {
    const [start, end] = reportingDayBounds(day as string, 'America/New_York')
    expect(end - start).toBe(Number(hours) * 3600000)
    const covering = [interval('day', 'work', new Date(start).toISOString(), new Date(end).toISOString())]
    expect(dailyFocusMs(covering, day as string, 'America/New_York')).toBe(Number(hours) * 3600000)
  })
  it('ignores active, invalid and negative intervals in finalized totals', () => {
    const invalid = [interval('active', 'work', '2026-10-01T10:00:00Z'), interval('bad', 'work', 'bad', 'invalid'), interval('negative', 'work', '2026-10-01T11:00:00Z', '2026-10-01T10:00:00Z')]
    expect(itemFocusMs(invalid, 'work')).toBe(0)
    expect(dailyFocusMs(invalid, '2026-10-01', 'UTC')).toBe(0)
  })
  it.each(['2026-02-30', 'bad'])('rejects invalid reporting date %s', (date) => { expect(() => reportingDayBounds(date, 'UTC')).toThrow('Invalid reporting date') })
})

describe('Continue where you left off', () => {
  it('shows only open, previously started, nonactive items ordered by latest ended interval', () => {
    const items = ['old', 'recent', 'active', 'never', 'pending'].map((id) => item(id)).concat(item('done', 'completed'))
    const sessions = [
      interval('old', 'old', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z'),
      interval('recent', 'recent', '2026-10-02T10:00:00Z', '2026-10-02T10:10:00Z'),
      interval('active-old', 'active', '2026-10-01T11:00:00Z', '2026-10-01T11:10:00Z'),
      interval('active', 'active', '2026-10-03T10:00:00Z'),
      interval('pending', 'pending', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z', { outcome: 'completed' }),
      interval('done', 'done', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z', { outcome: 'completed' }),
    ]
    expect(continueItems(items, sessions).map(({ item }) => item.recordId)).toEqual(['recent', 'old'])
  })
  it('uses only latest interval context, with no fallback when it has none', () => {
    const older = interval('old', 'work', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z', { leftOff: 'Old blocker', nextStep: 'Old next step' })
    const latest = interval('new', 'work', '2026-10-02T10:00:00Z', '2026-10-02T10:10:00Z')
    expect(continueItems([item('work')], [latest, older])).toEqual([{ item: item('work'), interval: latest }])
    expect(latestEndedIntervals([latest, older]).get('work')?.data.leftOff).toBeUndefined()
    latest.data.leftOff = 'Current blocker'
    expect(continueItems([item('work')], [older, latest])[0]?.interval.data).toMatchObject({ leftOff: 'Current blocker' })
    expect(continueItems([item('work')], [older, latest])[0]?.interval.data.nextStep).toBeUndefined()
  })
  it('removes resumed work while active, then uses the newly ended attempt', () => {
    const first = interval('first', 'work', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z')
    const second = interval('second', 'work', '2026-10-02T10:00:00Z')
    expect(continueItems([item('work')], [first, second])).toEqual([])
    Object.assign(second.data, { state: 'ended', outcome: 'stopped', endedAt: '2026-10-02T10:20:00Z', nextStep: 'Try this next' })
    expect(continueItems([item('work')], [first, second])[0]?.interval.recordId).toBe('second')
  })
  it('can show unfinished-at-close history even after that same item completes later', () => {
    const work = { ...item('work').data, status: 'completed' as const, completedAt: '2026-10-02T12:00:00Z' }
    expect(itemStatusAt(work, '2026-10-01T23:00:00Z')).toBe('open')
    expect(itemStatusAt(work, '2026-10-02T12:00:00Z')).toBe('completed')
  })
})

describe('Prior context for resumed focus', () => {
  it('selects the immediate predecessor using the same item and the active start cutoff', () => {
    const active = interval('active', 'work', '2026-10-02T12:00:00Z')
    const older = interval('older', 'work', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z', { leftOff: 'Old' })
    const immediate = interval('immediate', 'work', '2026-10-02T11:00:00Z', '2026-10-02T12:00:00Z', { leftOff: 'Current blocker', nextStep: 'Try partitioning' })
    const laterConflict = interval('later', 'work', '2026-10-02T12:01:00Z', '2026-10-02T12:10:00Z', { leftOff: 'Not the predecessor' })
    const other = interval('other', 'other', '2026-10-02T11:00:00Z', '2026-10-02T12:00:00Z', { leftOff: 'Wrong item' })
    expect(precedingInterval(active.data, [older, active, laterConflict, other, immediate])).toEqual(immediate)
    expect(active.data.leftOff).toBeUndefined()
    expect(active.data.nextStep).toBeUndefined()
  })
  it('does not fall back to older context when the predecessor has none', () => {
    const active = interval('active', 'work', '2026-10-03T10:00:00Z')
    const older = interval('older', 'work', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z', { leftOff: 'Stale', nextStep: 'Stale next' })
    const immediate = interval('immediate', 'work', '2026-10-02T10:00:00Z', '2026-10-02T10:10:00Z')
    expect(precedingInterval(active.data, [older, immediate])?.data.leftOff).toBeUndefined()
    expect(precedingInterval(active.data, [older, immediate])?.recordId).toBe('immediate')
  })
  it('derives the same context after a reload from record data alone', () => {
    const records = [interval('old', 'work', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z', { nextStep: 'Persisted next step' }), interval('active', 'work', '2026-10-02T10:00:00Z')]
    const reloaded = JSON.parse(JSON.stringify(records)) as typeof records
    expect(precedingInterval(reloaded[1]!.data, reloaded)?.data.nextStep).toBe('Persisted next step')
  })
  it('shows no predecessor for never-started work or an invalid end timestamp', () => {
    const active = interval('active', 'work', '2026-10-02T10:00:00Z')
    expect(precedingInterval(active.data, [])).toBeUndefined()
    expect(precedingInterval(active.data, [interval('bad', 'work', '2026-10-01T10:00:00Z', 'invalid')])).toBeUndefined()
  })
})
