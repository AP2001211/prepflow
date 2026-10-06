import type { PrepSession } from '../schemas/prep-schema'

export const FOCUS_CHECK_IN_MS = 90 * 60 * 1000

// Temporary local manual-test opt-in. Production ignores the flag entirely.
export function focusCheckInThreshold(development: boolean, shortLocalCheckIn?: string): number {
  return development && shortLocalCheckIn === '1' ? 60 * 1000 : FOCUS_CHECK_IN_MS
}

export function focusCheckInEligible(session: Pick<PrepSession, 'state' | 'startedAt' | 'lastCheckInAt'>, now: number, threshold = FOCUS_CHECK_IN_MS): boolean {
  const start = Date.parse(session.startedAt)
  const acknowledgement = Date.parse(session.lastCheckInAt ?? '')
  if (session.state !== 'active' || !Number.isFinite(start) || !Number.isFinite(now) || !Number.isFinite(threshold) || threshold <= 0) return false
  const basis = Math.max(start, Number.isFinite(acknowledgement) ? acknowledgement : start)
  return now >= basis + threshold
}
