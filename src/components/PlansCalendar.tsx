import { displayDate } from '../lib/display-date'

export function PlansCalendar({ month, selected, today, dates, onMonth, onSelect }: {
  month: string; selected: string; today: string; dates: Set<string>; onMonth: (month: string) => void; onSelect: (date: string) => void
}) {
  const [year, number] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year!, number! - 1, 1))
  const offset = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year!, number!, 0)).getUTCDate()
  const move = (delta: number) => onMonth(new Date(Date.UTC(year!, number! - 1 + delta, 1)).toISOString().slice(0, 7))
  return <aside className="plans-calendar" aria-label="Plan calendar">
    <div className="plans-calendar-heading"><button onClick={() => move(-1)} aria-label="Previous month">←</button><h2>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}</h2><button onClick={() => move(1)} aria-label="Next month">→</button></div>
    <div className="plans-calendar-grid">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => <span key={index} aria-hidden="true">{label}</span>)}
      {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
      {Array.from({ length: days }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`
        return <button key={date} className={date === selected ? 'is-selected' : ''} aria-label={`${displayDate(date)}${dates.has(date) ? ', has daily plans' : ''}`} aria-pressed={date === selected} aria-current={date === today ? 'date' : undefined} onClick={() => onSelect(date)}>{index + 1}{dates.has(date) && <span className="plans-calendar-dot" aria-hidden="true" />}</button>
      })}
    </div>
    <button className="plans-calendar-today" onClick={() => { onMonth(today.slice(0, 7)); onSelect(today) }}>Today</button>
  </aside>
}
