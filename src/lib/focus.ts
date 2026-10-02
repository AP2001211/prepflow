import type { RecordData } from 'deepspace'
import type { PlanItem, PrepSession } from '../schemas/prep-schema'

type Session = RecordData<PrepSession>

export function intervalFocusMs(session: PrepSession): number {
  if (session.state !== 'ended' || !session.endedAt) return 0
  const duration = Date.parse(session.endedAt) - Date.parse(session.startedAt)
  return Number.isFinite(duration) ? Math.max(0, duration) : 0
}

export function itemFocusMs(sessions: Session[], planItemId: string): number {
  return sessions.filter((session) => session.data.planItemId === planItemId)
    .reduce((total, session) => total + intervalFocusMs(session.data), 0)
}

export function latestEndedIntervals(sessions: Session[]): Map<string, Session> {
  const latest = new Map<string, Session>()
  for (const session of sessions) {
    if (session.data.state !== 'ended' || !session.data.endedAt) continue
    const previous = latest.get(session.data.planItemId)
    const time = Date.parse(session.data.endedAt)
    const previousTime = previous?.data.endedAt ? Date.parse(previous.data.endedAt) : -Infinity
    if (Number.isFinite(time) && (time > previousTime || (time === previousTime && session.recordId > (previous?.recordId ?? '')))) latest.set(session.data.planItemId, session)
  }
  return latest
}

export function continueItems(items: RecordData<PlanItem>[], sessions: Session[]) {
  const activeIds = new Set(sessions.filter((session) => session.data.state === 'active').map((session) => session.data.planItemId))
  const pendingIds = new Set(sessions.filter((session) => session.data.state === 'ended' && session.data.outcome === 'completed').map((session) => session.data.planItemId))
  const latest = latestEndedIntervals(sessions)
  return items.filter((item) => item.data.status === 'open' && !activeIds.has(item.recordId) && !pendingIds.has(item.recordId) && latest.has(item.recordId))
    .map((item) => ({ item, interval: latest.get(item.recordId)! }))
    .sort((a, b) => Date.parse(b.interval.data.endedAt!) - Date.parse(a.interval.data.endedAt!))
}

export function itemStatusAt(item: PlanItem, cutoff: string): 'open' | 'completed' {
  return item.status === 'completed' && !!item.completedAt && Date.parse(item.completedAt) <= Date.parse(cutoff) ? 'completed' : 'open'
}

/** Find the first instant of a local calendar date, including DST changes.
 * Binary search avoids assuming every reporting day is exactly 24 hours. */
export function reportingDayBounds(date: string, timeZone: string): [number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid reporting date')
  const formatter = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  function localDate(timestamp: number): string {
    const parts = formatter.formatToParts(timestamp)
    return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-')
  }
  function boundary(day: string): number {
    const center = Date.parse(`${day}T00:00:00Z`)
    let low = center - 36 * 3600000
    let high = center + 36 * 3600000
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (localDate(middle) < day) low = middle + 1
      else high = middle
    }
    return low
  }
  const nextDate = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  return [boundary(date), boundary(nextDate)]
}

export function dailyFocusMs(sessions: Session[], date: string, timeZone: string): number {
  const [dayStart, dayEnd] = reportingDayBounds(date, timeZone)
  return sessions.reduce((total, session) => {
    if (!intervalFocusMs(session.data) || !session.data.endedAt) return total
    return total + Math.max(0, Math.min(Date.parse(session.data.endedAt), dayEnd) - Math.max(Date.parse(session.data.startedAt), dayStart))
  }, 0)
}

export function formatFocus(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** Select the predecessor before inspecting context. Later-ended/conflicting
 * intervals must not change what was available when this attempt started. */
export function precedingInterval(active: PrepSession, sessions: Session[]): Session | undefined {
  return latestEndedIntervals(sessions.filter((row) => row.data.planItemId === active.planItemId &&
    row.data.state === 'ended' && !!row.data.endedAt && Date.parse(row.data.endedAt) <= Date.parse(active.startedAt))).get(active.planItemId)
}
