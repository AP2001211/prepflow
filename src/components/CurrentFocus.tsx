import { useQuery } from 'deepspace'
import { useFocus } from './FocusController'
import { FocusAttempt } from './FocusAttempt'
import { Button } from './ui'
import { runPrepAction } from '../lib/prep-actions'
import { precedingInterval } from '../lib/focus'
import type { PrepArea, Interview } from '../schemas/prep-schema'

export function CurrentFocus() {
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas')
  const interviews = useQuery<Interview>('interviews')
  return <section className="focus-content"><h2 className="focus-eyebrow">Current Focus</h2>
    {!focus.loaded && <p role="status">Loading focus…</p>}
    {(focus.sessions.error || focus.items.error) && <p role="alert">Could not load focus. Reconnect or reload.</p>}
    {focus.active.length > 1 && <p role="alert">You have {focus.active.length} active sessions, possibly from simultaneous starts in different tabs. End the extra attempts below. Starting another session is disabled.</p>}
    {focus.active.map((record) => {
      const draft = focus.draft(record.recordId, record.data.notes)
      return <FocusAttempt key={record.recordId} record={record} notes={draft.notes} stop={draft.stop}
        predecessor={precedingInterval(record.data, focus.sessions.records)}
        area={areas.records.find((row) => row.recordId === record.data.prepAreaId)?.data.name ?? 'Prep Area'}
        interview={record.data.interviewId ? interviews.records.find((row) => row.recordId === record.data.interviewId)?.data.company ?? 'Interview' : 'General preparation'}
        disabled={!focus.ready} onNotes={(notes) => focus.setNotes(record.recordId, notes)}
        onStuck={(notes) => focus.stuck(record.recordId, notes)}
        onEnd={(outcome) => focus.end(record.recordId, outcome)} />
    })}
    {focus.awaitingFocus && <p role="status">Your session was accepted. Waiting for the live workspace to update…</p>}
    {focus.loaded && !focus.active.length && !focus.awaitingFocus && <p>No current focus. Resume unfinished work or start an attempt below.</p>}
    {focus.pending.map((row) => <div key={row.recordId} className="mt-4 space-y-2"><p role="alert">Focus on “{row.data.intent}” has ended. Item completion still needs confirmation; this work cannot be resumed yet.</p><Button disabled={!focus.ready} onClick={() => void focus.save(async () => { await runPrepAction('reconcileCompletion', { sessionId: row.recordId }); if (focus.completionRetryId === row.recordId) focus.setCompletionRetryId(null); if (row.data.endedAt) focus.acknowledgeCompletion({ sessionId: row.recordId, title: row.data.intent, startedAt: row.data.startedAt, endedAt: row.data.endedAt }) })}>Retry completion</Button></div>)}
  </section>
}
