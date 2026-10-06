import type { FormEvent } from 'react'
import { useQuery } from 'deepspace'
import type { PrepArea, Interview } from '../../../schemas/prep-schema'
import { InterviewContext } from '../../../components/PreparationContext'
import { useFocus } from '../../../components/FocusController'
import { useSave } from '../../../lib/use-save'
import { useLocalDay } from '../../../lib/use-local-day'
import { runPrepAction } from '../../../lib/prep-actions'

export default function InterviewsPage() {
  const focus = useFocus()
  const { planDate: today } = useLocalDay()
  const areas = useQuery<PrepArea>('prep-areas', { orderBy: 'createdAt', orderDir: 'desc' })
  const interviews = useQuery<Interview>('interviews', { orderBy: 'createdAt', orderDir: 'desc' })
  const ready = focus.ready && areas.status === 'ready' && interviews.status === 'ready'
  const feedback = useSave(ready)
  async function createInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    await feedback.save(async () => { await runPrepAction('createInterview', { company: String(data.get('company') ?? ''), role: String(data.get('role') ?? ''), scheduledDate: String(data.get('scheduledDate') ?? ''), stage: String(data.get('stage') ?? ''), notes: String(data.get('notes') ?? ''), prepAreaIds: data.getAll('prepAreaIds').map(String) }); form.reset() }, 'Interview saved.')
  }
  return <div className="plans-flow interviews-page">
    <h1>Interviews</h1><p className="text-muted-foreground">The interviews you’re preparing toward.</p>
    {(areas.error || interviews.error) && <p role="alert">Could not load your context. Reconnect or reload.</p>}
    {feedback.error && <p role="alert">{feedback.error}</p>}{feedback.notice && <p role="status">{feedback.notice}</p>}
    {(areas.status !== 'ready' || interviews.status !== 'ready') && !(areas.error || interviews.error) && <p role="status">Loading interviews…</p>}
    {areas.status === 'ready' && interviews.status === 'ready' && !areas.error && !interviews.error && <InterviewContext today={today} areas={areas.records} interviews={interviews.records} ready={ready && !feedback.busy} areaName={(id) => areas.records.find((row) => row.recordId === id)?.data.name ?? 'Unavailable Prep Area'} onCreateInterview={createInterview} />}
  </div>
}
