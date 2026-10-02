import type { FormEvent } from 'react'
import { useMutations, useQuery } from 'deepspace'
import type { PrepArea, Interview } from '../../../schemas/prep-schema'
import { PreparationContext } from '../../../components/PreparationContext'
import { useFocus } from '../../../components/FocusController'
import { useSave } from '../../../lib/use-save'
import { runPrepAction } from '../../../lib/prep-actions'

export default function PrepPage() {
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas', { orderBy: 'createdAt', orderDir: 'desc' })
  const interviews = useQuery<Interview>('interviews', { orderBy: 'createdAt', orderDir: 'desc' })
  const mutations = useMutations<PrepArea>('prep-areas')
  const ready = focus.ready && areas.status === 'ready' && interviews.status === 'ready' && mutations.ready
  const feedback = useSave(ready)
  async function createArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    await feedback.save(async () => { const name = String(data.get('name') ?? '').trim(); if (!name) throw new Error('Enter a Prep Area name.'); await mutations.createConfirmed({ name, notes: String(data.get('notes') ?? '').trim() }); form.reset() }, 'Prep Area saved.')
  }
  async function createInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    await feedback.save(async () => { await runPrepAction('createInterview', { company: String(data.get('company') ?? ''), role: String(data.get('role') ?? ''), scheduledDate: String(data.get('scheduledDate') ?? ''), stage: String(data.get('stage') ?? ''), notes: String(data.get('notes') ?? ''), prepAreaIds: data.getAll('prepAreaIds').map(String) }); form.reset() }, 'Interview saved.')
  }
  return <div className="mx-auto max-w-5xl space-y-6 px-5 py-8"><h1 className="text-3xl font-semibold">My Prep</h1>
    <p>Manage what you want to practice and optional interview context.</p>
    {(areas.error || interviews.error) && <p role="alert">Could not load your context. Reconnect or reload.</p>}
    {feedback.error && <p role="alert">{feedback.error}</p>}{feedback.notice && <p role="status">{feedback.notice}</p>}
    <PreparationContext areas={areas.records} interviews={interviews.records} ready={ready && !feedback.busy} areaName={(id) => areas.records.find((row) => row.recordId === id)?.data.name ?? 'Unavailable Prep Area'} onCreateArea={createArea} onCreateInterview={createInterview} />
  </div>
}
