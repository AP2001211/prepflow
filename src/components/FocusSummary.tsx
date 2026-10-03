import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { useFocus } from './FocusController'
import { formatFocus } from '../lib/focus'
import type { PrepArea, Interview } from '../schemas/prep-schema'

export function FocusSummary() {
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas')
  const interviews = useQuery<Interview>('interviews')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  if (focus.loaded && !focus.active.length && !focus.pending.length && !focus.awaitingFocus && !focus.sessions.error && !focus.items.error) return null
  return <section aria-label="Current Focus" className={focus.active.length ? 'home-hero focus-hero' : 'quiet-focus'}>
    <h2 className={focus.active.length ? 'eyebrow' : 'text-sm font-medium'}>Current Focus</h2>
    {!focus.loaded && <p role="status">Loading focus…</p>}
    {(focus.sessions.error || focus.items.error) && <p role="alert">Could not load focus. Reconnect or reload.</p>}
    {focus.loaded && !focus.active.length && <p className="text-sm text-muted-foreground">{focus.awaitingFocus ? 'Your focus is starting…' : 'No current focus. Choose a small commitment below.'}</p>}
    {focus.active.length > 1 && <p role="alert">Multiple focus intervals are active. Return to focus to resolve them; starting another is disabled.</p>}
    {focus.active.map((record) => {
      const stop = focus.draft(record.recordId).stop
      const area = areas.records.find((row) => row.recordId === record.data.prepAreaId)?.data.name
      const interview = interviews.records.find((row) => row.recordId === record.data.interviewId)?.data.company
      return <article key={record.recordId} className="focus-summary-content">
        <p className="focus-intro">You are currently focusing on</p>
        <h3 className="display-title break-words">{record.data.intent}</h3>
        <p>{area ?? 'Prep Area'} · {interview ?? 'General preparation'}</p>
        <p aria-label="Focus duration" className="focus-summary-timer">{formatFocus(Math.max(0, (stop ? Date.parse(stop.endedAt) : now) - Date.parse(record.data.startedAt)))}</p>
        {stop && <p>Focus time is fixed. Return to focus to confirm the end.</p>}
      </article>
    })}
    {(focus.active.length > 0 || focus.pending.length > 0 || focus.awaitingFocus) && <Link to="/focus" className="focus-return">Return to focus →</Link>}
    {focus.pending.length > 0 && <p role="alert">Focus has ended; item completion needs confirmation. <Link to="/focus" className="underline">Retry completion in Focus</Link></p>}
  </section>
}
