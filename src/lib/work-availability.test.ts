import { describe, expect, it } from 'vitest'
import { isAutomaticallyAvailable } from './work-availability'
import { continueItems } from './focus'
import { unfinishedWork } from './plans'
import type { RecordData } from 'deepspace'
import type { PlanItem, PrepSession } from '../schemas/prep-schema'

describe('automatic work availability', () => {
  it.each([['2026-10-05', false], ['2026-10-06', false], ['2026-10-07', true], ['2026-10-08', true]])('compares the target %s with the canonical date', (date, expected) => {
    expect(isAutomaticallyAvailable({ availableFrom: '2026-10-07' }, date)).toBe(expected)
  })
  it('preserves legacy work and fails safely on malformed availability dates', () => {
    expect(isAutomaticallyAvailable({}, '2026-10-05')).toBe(true)
    expect(isAutomaticallyAvailable({ availableFrom: '2026-02-30' }, '2026-10-05')).toBe(false)
  })
  it('does not alter explicit inventory or previously attempted Pick Back Up eligibility', () => {
    const item = { recordId: 'future', data: { intent: 'Future work', status: 'open', availableFrom: '2026-10-07' } } as RecordData<PlanItem>
    const session = { recordId: 'attempt', data: { planItemId: 'future', state: 'ended', outcome: 'stopped', endedAt: '2026-10-05T12:00:00Z', leftOff: 'Checkpoint' } } as RecordData<PrepSession>
    expect(unfinishedWork([item])).toEqual([item])
    expect(continueItems([item], [])).toEqual([])
    expect(continueItems([item], [session])[0]?.interval.data.leftOff).toBe('Checkpoint')
  })
})
