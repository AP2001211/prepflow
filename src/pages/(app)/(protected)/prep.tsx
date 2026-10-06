import type { FormEvent } from 'react'
import { useMutations, useQuery } from 'deepspace'
import type { PrepArea } from '../../../schemas/prep-schema'
import { PrepPlans } from '../../../components/PrepPlans'
import { PreparationContext } from '../../../components/PreparationContext'
import { useFocus } from '../../../components/FocusController'
import { useSave } from '../../../lib/use-save'

export default function PrepPage() {
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas', { orderBy: 'createdAt', orderDir: 'desc' })
  const mutations = useMutations<PrepArea>('prep-areas')
  const ready = focus.ready && areas.status === 'ready' && mutations.ready
  const feedback = useSave(ready)
  async function createArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    await feedback.save(async () => { const name = String(data.get('name') ?? '').trim(); if (!name) throw new Error('Enter a Prep Area name.'); await mutations.createConfirmed({ name, notes: String(data.get('notes') ?? '').trim() }); form.reset() }, 'Prep Area saved.')
  }
  return <div className="plans-flow my-prep mx-auto max-w-5xl space-y-6 px-5 py-8"><h1 className="text-3xl font-semibold">My Prep</h1>
    <p>Your preparation direction and reusable areas.</p>
    {areas.error && <p role="alert">Could not load your context. Reconnect or reload.</p>}
    {feedback.error && <p role="alert">{feedback.error}</p>}{feedback.notice && <p role="status">{feedback.notice}</p>}
    <PrepPlans />
    {areas.status !== 'ready' && !areas.error && <p role="status">Loading prep areas…</p>}
    {areas.status === 'ready' && !areas.error && <PreparationContext areas={areas.records} ready={ready && !feedback.busy} onCreateArea={createArea} />}
  </div>
}
