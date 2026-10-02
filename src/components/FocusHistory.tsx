import { useQuery } from 'deepspace'
import type { PrepArea, Interview, Plan } from '../schemas/prep-schema'
import { useFocus } from './FocusController'
import { Section, dateTime } from './prep-ui'
import { formatFocus, intervalFocusMs } from '../lib/focus'

export function FocusHistory() {
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas')
  const interviews = useQuery<Interview>('interviews')
  const plans = useQuery<Plan>('plans')
  const ended = focus.sessions.records.filter((row) => row.data.state === 'ended').sort((a, b) => Date.parse(b.data.endedAt!) - Date.parse(a.data.endedAt!))
  return <Section title="Recent Focus History">
    {focus.sessions.error && <p role="alert">Could not load focus history.</p>}
    {focus.loaded && !ended.length && <p>Your ended focus intervals will appear here.</p>}
    <ul className="space-y-4">{ended.slice(0, 20).map((record) => <li key={record.recordId} className="border-b border-border pb-4">
      <h3 className="font-medium break-words">{record.data.intent}</h3>
      <p className="text-sm">{areas.records.find((area) => area.recordId === record.data.prepAreaId)?.data.name ?? 'Prep Area'} · {record.data.interviewId ? interviews.records.find((row) => row.recordId === record.data.interviewId)?.data.company ?? 'Interview' : 'General preparation'}{record.data.planId ? ` · ${plans.records.find((plan) => plan.recordId === record.data.planId)?.data.title ?? 'Plan unavailable'}` : ''}</p>
      <p className="text-sm text-muted-foreground">{record.data.outcome} · {dateTime(record.data.startedAt)} → {dateTime(record.data.endedAt!)} · {formatFocus(intervalFocusMs(record.data))}{record.data.encounteredStuck ? ' · Encountered difficulty' : ''}</p>
      {record.data.notes && <p className="whitespace-pre-wrap break-words text-sm">{record.data.notes}</p>}
    </li>)}</ul>
    {ended.length > 20 && <p className="mt-3 text-sm">Showing the 20 most recent ended intervals.</p>}
  </Section>
}
