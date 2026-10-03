import { useEffect, useState } from 'react'
import type { RecordData } from 'deepspace'
import type { PrepSession, SessionOutcome } from '../schemas/prep-schema'
import { formatFocus } from '../lib/focus'
import { FileText } from 'lucide-react'
import { FocusNotebook } from './FocusNotebook'
import { Button } from './ui'
import { dateTime } from './prep-ui'

export function FocusAttempt({ record, area, interview, disabled, predecessor, notes, stop, onNotes, onStuck, onEnd }: {
  record: RecordData<PrepSession>
  area: string
  interview: string
  disabled: boolean
  predecessor?: RecordData<PrepSession>
  notes: string
  stop?: { outcome: SessionOutcome; endedAt: string }
  onNotes: (notes: string) => void
  onStuck: (notes: string) => Promise<boolean>
  onEnd: (outcome: SessionOutcome) => Promise<boolean>
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (stop) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [stop])

  const elapsed = Math.max(0, (stop ? Date.parse(stop.endedAt) : now) - Date.parse(record.data.startedAt))
  return (
    <article className="focus-attempt">
      <div className="focus-scene">
        <div className="focus-identity"><h3 className="focus-task-title">{record.data.intent}</h3><p className="focus-task-context">{area} · {interview}</p><p className="focus-started">Started {dateTime(record.data.startedAt)}</p></div>
        <div className="focus-time"><p className="focus-elapsed" aria-label="Focus duration">{formatFocus(elapsed)}</p><p className="focus-time-label">Time in focus</p></div>
        <aside className="focus-session-context" aria-label={predecessor?.data.leftOff || predecessor?.data.nextStep ? 'Context from your previous attempt' : 'Session Context'}>
          <div className="focus-context-heading"><h4>Session Context</h4><FileText size={20} aria-hidden="true" /></div>
          {predecessor?.data.leftOff && <div><h5>Last time</h5><p className="context-left-off">Left off: {predecessor.data.leftOff}</p></div>}
          {predecessor?.data.nextStep && <div><h5>Next step</h5><p>Next: {predecessor.data.nextStep}</p></div>}
          {!(predecessor?.data.leftOff || predecessor?.data.nextStep) && <p className="focus-context-empty">No saved context from your previous attempt.</p>}
        </aside>
      </div>
      {record.data.encounteredStuck ? <p className="text-sm">Difficulty reported during this attempt. You can keep working.</p> : null}
      <FocusNotebook intent={record.data.intent} notes={notes} onNotes={onNotes} disabled={disabled || !!stop} />
      {stop ? (
        <div className="space-y-2">
          <p role="status">Timer stopped. Waiting for the end to be confirmed. Retry if saving failed; the stop time will stay fixed.</p>
          <Button disabled={disabled} onClick={() => void onEnd(stop.outcome)}>Retry ending focus</Button>
        </div>
      ) : (
        <div className="focus-actions">
          <Button variant="outline" disabled={disabled || !!record.data.encounteredStuck} onClick={() => void onStuck(notes)}>Report difficulty (keep working)</Button>
          <Button disabled={disabled} onClick={() => void onEnd('completed')}>Complete</Button>
          <Button variant="outline" disabled={disabled} onClick={() => void onEnd('stopped')}>Stop</Button>
          <Button variant="ghost" className="focus-switch" disabled={disabled} onClick={() => void onEnd('switched')}>End to switch</Button>
        </div>
      )}
      <p className="focus-helper">Notes save when you report difficulty or end focus. Switch/Stop leaves the work open; resume context is optional and can be added afterward.</p>
    </article>
  )
}
