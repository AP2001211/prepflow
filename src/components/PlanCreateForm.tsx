import { useNavigate } from 'react-router-dom'
import { useFocus } from './FocusController'
import { useSave } from '../lib/use-save'
import { runPrepAction } from '../lib/prep-actions'
import { Button, Input } from './ui'
import { Field } from './prep-ui'

export function PlanCreateForm() {
  const focus = useFocus()
  const feedback = useSave(focus.ready)
  const navigate = useNavigate()
  return <form onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    void feedback.save(async () => {
      const datetime = (key: string) => data.get(key) ? new Date(String(data.get(key))).toISOString() : undefined
      const id = await runPrepAction('createPlan', { title: String(data.get('title') ?? ''), startsAt: datetime('startsAt'), endsAt: datetime('endsAt'), budgetMinutes: data.get('budgetMinutes') ? Number(data.get('budgetMinutes')) : undefined })
      navigate(`/plans/${id}`)
    }, 'Plan created.')
  }}>
    {feedback.error && <p role="alert">{feedback.error}</p>}
    <fieldset disabled={!focus.ready || feedback.busy} className="grid gap-3 sm:grid-cols-2">
      <Field label="Plan title"><Input name="title" required maxLength={200} /></Field>
      <Field label="Time budget in minutes (optional)"><Input name="budgetMinutes" type="number" min="0.01" step="any" /></Field>
      <Field label="Plan starts (optional)"><Input name="startsAt" type="datetime-local" /></Field>
      <Field label="Plan ends (optional)"><Input name="endsAt" type="datetime-local" /></Field>
      <Button type="submit">Create Plan</Button>
    </fieldset>
  </form>
}
