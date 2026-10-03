/** Format a date-only value without changing its calendar day. */
export function displayDate(planDate: string, compact = false) {
  const [year, month, day] = planDate.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, compact ? { month: 'short', day: 'numeric', timeZone: 'UTC' } : { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year!, month! - 1, day!)))
}
