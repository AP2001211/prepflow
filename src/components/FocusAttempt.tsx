import { useEffect, useState } from 'react'
import type { RecordData } from 'deepspace'
import type { PrepSession, SessionOutcome } from '../schemas/prep-schema'
import { formatFocus } from '../lib/focus'
import { Button, Textarea } from './ui'
import { dateTime, Field } from './prep-ui'

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
    <article className="mb-4 space-y-3 rounded-md border border-border p-4">
      <h3 className="font-semibold break-words">{record.data.intent}</h3>
      <p className="text-sm">{area} · {interview}</p>
      <p className="text-sm text-muted-foreground">Started {dateTime(record.data.startedAt)}</p>
      <p className="font-mono text-lg" aria-label="Focus duration">{formatFocus(elapsed)}</p>
      {(predecessor?.data.leftOff || predecessor?.data.nextStep) && <aside className="space-y-2 rounded border border-border p-3" aria-label="Context from your previous attempt">
        <h4 className="font-medium">Context from your previous attempt</h4>
        {predecessor.data.leftOff && <p className="whitespace-pre-wrap break-words text-sm">Left off: {predecessor.data.leftOff}</p>}
        {predecessor.data.nextStep && <p className="whitespace-pre-wrap break-words text-sm">Next: {predecessor.data.nextStep}</p>}
      </aside>}
      {record.data.encounteredStuck ? <p className="text-sm">Difficulty reported during this attempt. You can keep working.</p> : null}
      <Field label="Session notes — progress, difficulty, or where you stopped">
        <Textarea value={notes} onChange={(event) => onNotes(event.target.value)} maxLength={10000} disabled={disabled || !!stop} />
      </Field>
      {stop ? (
        <div className="space-y-2">
          <p role="status">Timer stopped. Waiting for the end to be confirmed. Retry if saving failed; the stop time will stay fixed.</p>
          <Button disabled={disabled} onClick={() => void onEnd(stop.outcome)}>Retry ending focus</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={disabled || !!record.data.encounteredStuck} onClick={() => void onStuck(notes)}>Report difficulty (keep working)</Button>
          <Button disabled={disabled} onClick={() => void onEnd('completed')}>Complete</Button>
          <Button variant="secondary" disabled={disabled} onClick={() => void onEnd('stopped')}>Stop</Button>
          <Button variant="secondary" disabled={disabled} onClick={() => void onEnd('switched')}>End to switch</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Notes save when you report difficulty or end focus. Switch/Stop leaves the work open; resume context is optional and can be added afterward.</p>
    </article>
  )
}
