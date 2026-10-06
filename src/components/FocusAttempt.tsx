import { useEffect, useState } from 'react'
import type { RecordData } from 'deepspace'
import type { PrepSession, SessionOutcome } from '../schemas/prep-schema'
import { formatFocus } from '../lib/focus'
import { FileText } from 'lucide-react'
import { focusCheckInEligible, focusCheckInThreshold } from '../lib/focus-check-in'
import { FocusCheckIn } from './FocusCheckIn'
import { FocusNotebook } from './FocusNotebook'
import { Button } from './ui'
import { dateTime } from './prep-ui'

export function FocusAttempt({ record, area, interview, disabled, predecessor, notes, stop, onNotes, onStuck, onEnd, checkInSuppressed = true, onCheckIn }: {
  checkInSuppressed?: boolean
  onCheckIn?: () => Promise<boolean>
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
    const refreshTime = () => setNow(Date.now())
    const timer = window.setInterval(refreshTime, 1000)
    document.addEventListener('visibilitychange', refreshTime)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshTime) }
  }, [stop])

  const checkInThreshold = focusCheckInThreshold(import.meta.env.DEV, import.meta.env.VITE_PREPFLOW_SHORT_CHECK_IN)
  const elapsed = Math.max(0, (stop ? Date.parse(stop.endedAt) : now) - Date.parse(record.data.startedAt))
  return (
    <article className="focus-attempt">
      <div className="focus-scene">
        <div className="focus-identity"><h3 className="focus-task-title">{record.data.intent}</h3><p className="focus-task-context">{area} · {interview}</p><p className="focus-started">Started {dateTime(record.data.startedAt)}</p></div>
        <div className="focus-time"><p className="focus-elapsed" aria-label="Focus duration">{formatFocus(elapsed)}</p><p className="focus-time-label">Time in focus</p></div>
        {(record.data.instructions || predecessor?.data.leftOff || predecessor?.data.nextStep) && <aside className="focus-session-context" aria-label={predecessor?.data.leftOff || predecessor?.data.nextStep ? 'Context from your previous attempt' : 'Session Context'}>
          <div className="focus-context-heading"><h4>Session Context</h4><FileText size={20} aria-hidden="true" /></div>
          {record.data.instructions && <details className="focus-instructions"><summary>How to approach this</summary><p className="whitespace-pre-wrap break-words">{record.data.instructions}</p></details>}
          {predecessor?.data.leftOff && <div><h5>Last time</h5><p className="context-left-off">{predecessor.data.leftOff}</p></div>}
          {predecessor?.data.nextStep && <div><h5>Next step</h5><p>{predecessor.data.nextStep}</p></div>}
        </aside>}
      </div>
      {!disabled && !stop && !checkInSuppressed && onCheckIn && focusCheckInEligible(record.data, now, checkInThreshold) && <FocusCheckIn title={record.data.intent} onKeep={onCheckIn} onEnd={onEnd} />}
      <FocusNotebook intent={record.data.intent} notes={notes} onNotes={onNotes} disabled={disabled || !!stop} />
      {stop ? (
        <div className="space-y-2">
          <p role="status">Timer stopped. Waiting for the end to be confirmed. Retry if saving failed; the stop time will stay fixed.</p>
          <Button disabled={disabled} onClick={() => void onEnd(stop.outcome)}>Retry ending focus</Button>
        </div>
      ) : (
        <div className="focus-actions">
          <>{record.data.encounteredStuck ? <p role="status" className="focus-difficulty-noted">✓ Difficulty noted <span>You can keep working.</span></p> : <Button variant="outline" className="focus-report-difficulty" disabled={disabled} onClick={() => void onStuck(notes)}>Report difficulty (keep working)</Button>}</>
          <Button disabled={disabled} onClick={() => void onEnd('completed')}>Complete</Button>
          <Button variant="outline" disabled={disabled} onClick={() => void onEnd('stopped')}>Stop</Button>
          <Button variant="ghost" className="focus-switch" disabled={disabled} onClick={() => void onEnd('switched')}>End to switch</Button>
        </div>
      )}
      <p className="focus-helper">Notes autosave while you work and save when you report difficulty or end focus. Switch/Stop leaves the work open; resume context is optional and can be added afterward.</p>
    </article>
  )
}
