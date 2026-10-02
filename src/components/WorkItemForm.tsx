import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { PrepArea, Interview } from '../schemas/prep-schema'
import { useFocus } from './FocusController'
import { useSave } from '../lib/use-save'
import { runPrepAction } from '../lib/prep-actions'
import { Button, Input, Textarea } from './ui'
import { Field, selectClass } from './prep-ui'

export function WorkItemForm({ planId, startNow = false, onSaved }: { planId?: string; startNow?: boolean; onSaved?: () => void }) {
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas', { orderBy: 'createdAt', orderDir: 'desc' })
  const interviews = useQuery<Interview>('interviews', { orderBy: 'createdAt', orderDir: 'desc' })
  const requestId = useRef<string | null>(null)
  const ready = focus.ready && areas.status === 'ready' && interviews.status === 'ready' && (!startNow || focus.canStart)
  const feedback = useSave(ready)
  if (areas.status === 'ready' && !areas.records.length) return <p>Create your first Prep Area in <Link to="/prep" className="underline">My Prep</Link>. You do not need an interview or a plan.</p>
  return <form onSubmit={(event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    void feedback.save(async () => {
      requestId.current ??= crypto.randomUUID()
      const id = await runPrepAction('createPlanItem', { requestId: requestId.current, prepAreaId: String(data.get('prepAreaId')), interviewId: String(data.get('interviewId') ?? '') || undefined, intent: String(data.get('intent')), planId })
      if (startNow && !await focus.start(id, planId, String(data.get('notes') ?? ''))) throw new Error('Work was saved, but focus could not start. Retry or open it from Plans.')
      requestId.current = null; form.reset(); onSaved?.()
    }, startNow ? 'Focus session started.' : 'Intended work added.')
  }}>
    {feedback.error && <p role="alert">{feedback.error}</p>}{feedback.notice && <p role="status">{feedback.notice}</p>}
    <fieldset disabled={!ready || feedback.busy} className="space-y-3">
      <Field label="Prep Area"><select name="prepAreaId" className={selectClass} required defaultValue=""><option value="" disabled>Choose an area</option>{areas.records.map((area) => <option key={area.recordId} value={area.recordId}>{area.data.name}</option>)}</select></Field>
      <Field label="Interview (optional)"><select name="interviewId" className={selectClass}><option value="">General preparation</option>{interviews.records.map((row) => <option key={row.recordId} value={row.recordId}>{row.data.company}</option>)}</select></Field>
      <Field label="What do you intend to work on?"><Input name="intent" required maxLength={10000} /></Field>
      {startNow && <Field label="Starting notes (optional)"><Textarea name="notes" maxLength={10000} /></Field>}
      <Button type="submit">{startNow ? 'Start focus session' : 'Add intended work'}</Button>
    </fieldset>
  </form>
}
