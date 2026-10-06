import { describe, expect, it } from 'vitest'
import { focusCheckInEligible, focusCheckInThreshold, FOCUS_CHECK_IN_MS } from './focus-check-in'
const start = Date.parse('2026-10-04T14:00:00Z')
const session = { state: 'active' as const, startedAt: new Date(start).toISOString() }
describe('explicit focus check-in timing', () => {
  it('qualifies exactly at 90 minutes, never before', () => {
    expect(focusCheckInEligible(session, start + FOCUS_CHECK_IN_MS - 1)).toBe(false)
    expect(focusCheckInEligible(session, start + FOCUS_CHECK_IN_MS)).toBe(true)
    expect(focusCheckInEligible(session, start + FOCUS_CHECK_IN_MS + 1)).toBe(true)
  })
  it('uses acknowledgement without resetting the session start', () => {
    const acknowledged = { ...session, lastCheckInAt: new Date(start + FOCUS_CHECK_IN_MS + 120000).toISOString() }
    expect(focusCheckInEligible(acknowledged, start + 2 * FOCUS_CHECK_IN_MS)).toBe(false)
    expect(focusCheckInEligible(acknowledged, start + 2 * FOCUS_CHECK_IN_MS + 120000)).toBe(true)
    expect(focusCheckInEligible({ ...session, lastCheckInAt: new Date(start - 1000).toISOString() }, start + FOCUS_CHECK_IN_MS)).toBe(true)
  })
  it('fails safely and permits deterministic thresholds', () => {
    expect(focusCheckInEligible({ ...session, startedAt: 'bad' }, start + FOCUS_CHECK_IN_MS)).toBe(false)
    expect(focusCheckInEligible({ ...session, lastCheckInAt: 'bad' }, start + FOCUS_CHECK_IN_MS)).toBe(true)
    expect(focusCheckInEligible({ ...session, state: 'ended' }, start + FOCUS_CHECK_IN_MS)).toBe(false)
    expect(focusCheckInEligible(session, NaN)).toBe(false)
    expect(focusCheckInEligible(session, start + 1000, 1000)).toBe(true)
  })
})

 it('permits an explicit short local check but always uses 90 minutes in production', () => {
  expect(focusCheckInThreshold(true, '1')).toBe(60000)
  expect(focusCheckInThreshold(true)).toBe(5400000)
  expect(focusCheckInThreshold(true, '0')).toBe(5400000)
  expect(focusCheckInThreshold(false, '1')).toBe(5400000)
  expect(focusCheckInThreshold(false)).toBe(5400000)
})
