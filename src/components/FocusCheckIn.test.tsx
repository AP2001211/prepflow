import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FocusAttempt } from './FocusAttempt'
import type { RecordData } from 'deepspace'
import type { PrepSession } from '../schemas/prep-schema'
const now = Date.now()
const record = { recordId: 'same-session', data: { state: 'active', startedAt: new Date(now - 90 * 60000 - 1000).toISOString(), intent: 'Current work', encounteredStuck: true, notes: 'Original notes' } } as RecordData<PrepSession>
const props = { record, area: 'DSA', interview: 'General preparation', disabled: false, checkInSuppressed: false, onCheckIn: vi.fn(async () => true), notes: 'Original notes', onNotes: vi.fn(), onStuck: vi.fn(async () => true), onEnd: vi.fn(async () => true) }
describe('Focus check-in presentation', () => {
  it('shows neutral current-work choices alongside timer and untouched notebook', () => {
    const html = renderToStaticMarkup(<FocusAttempt {...props} />)
    expect(html).toContain('Still working on Current work?')
    expect(html).toContain('Keep focusing'); expect(html).toContain('I switched'); expect(html).toContain('I stopped')
    expect(html).toContain('Original notes'); expect(html).toContain('Focus duration')
    expect(html).toContain('Difficulty noted')
  })
  it.each([
    { checkInSuppressed: true }, { disabled: true },
    { stop: { outcome: 'switched' as const, endedAt: new Date(now).toISOString() } },
    { record: { ...record, data: { ...record.data, state: 'ended' as const } } },
    { record: { ...record, data: { ...record.data, lastCheckInAt: new Date(now).toISOString() } } },
    { record: { ...record, data: { ...record.data, startedAt: new Date(now).toISOString() } } },
  ])('suppresses unavailable, competing, acknowledged or ineligible state %j', (override) => {
    expect(renderToStaticMarkup(<FocusAttempt {...props} {...override} />)).not.toContain('Still working on')
  })
})
