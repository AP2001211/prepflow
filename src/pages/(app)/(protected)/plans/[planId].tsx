import { Link, useParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { Plan, PrepArea } from '../../../../schemas/prep-schema'
import { useFocus } from '../../../../components/FocusController'
import { Section, Field, selectClass, dateTime } from '../../../../components/prep-ui'
import { WorkItemRow } from '../../../../components/WorkItemRow'
import { WorkItemForm } from '../../../../components/WorkItemForm'
import { Button } from '../../../../components/ui'
import { useSave } from '../../../../lib/use-save'
import { runPrepAction } from '../../../../lib/prep-actions'
import { itemMemberships } from '../../../../lib/plans'

export default function PlanDetailPage() {
  const { planId } = useParams()
  const plans = useQuery<Plan>('plans', { orderBy: 'createdAt', orderDir: 'desc' })
  const areas = useQuery<PrepArea>('prep-areas')
  const focus = useFocus()
  const feedback = useSave(focus.ready && plans.status === 'ready')
  const plan = plans.records.find((row) => row.recordId === planId)
  if (plans.status !== 'ready') return <p className="p-5" role={plans.error ? 'alert' : 'status'}>{plans.error ? 'Could not load this plan.' : 'Loading plan…'}</p>
  if (!plan) return <div className="p-5"><p role="alert">Plan unavailable.</p><Link to="/plans" className="underline">Back to Plans</Link></div>
  const candidates = focus.items.records.filter((item) => item.data.status === 'open' && !focus.pendingIds.has(item.recordId) && !plan.data.planItemIds.includes(item.recordId))
  return <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
    <Link to="/plans" className="underline">Back to Plans</Link>
    <h1 className="text-3xl font-semibold break-words">{plan.data.title}</h1>
    {plan.data.planDate && <p className="eyebrow">Daily Plan · {plan.data.planDate}</p>}
    <p>{plan.data.closedAt ? `Closed ${dateTime(plan.data.closedAt)} — membership is fixed` : 'Open plan'}{plan.data.budgetMinutes ? ` · ${plan.data.budgetMinutes} minute budget` : ''}{plan.data.startsAt ? ` · From ${dateTime(plan.data.startsAt)}` : ''}{plan.data.endsAt ? ` · Until ${dateTime(plan.data.endsAt)}` : ''}</p>
    {feedback.error && <p role="alert">{feedback.error}</p>}{feedback.notice && <p role="status">{feedback.notice}</p>}
    <Section title="Intended Work">
      {!plan.data.planItemIds.length && <p>No intended work yet. Add new work or include an existing item below.</p>}
      <ol className="list-inside list-decimal space-y-4">{plan.data.planItemIds.map((id) => { const item = focus.items.records.find((row) => row.recordId === id); return <li key={id}>{item ? <WorkItemRow item={item} plans={plans.records} plan={plan} /> : 'Intended work unavailable'}</li> })}</ol>
    </Section>
    {!plan.data.closedAt && !plan.data.planDate && <>
      <Section title="Add New Intended Work"><WorkItemForm key={plan.recordId} planId={plan.recordId} /></Section>
      <Section title="Include Existing Unfinished Work">
        <p className="mb-3 text-sm">Include the same item without duplicating it or removing it from another plan.</p>
        <form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const id = String(new FormData(form).get('planItemId') ?? ''); void feedback.save(async () => { await runPrepAction('addPlanItem', { planId: plan.recordId, planItemId: id }); form.reset() }, 'Work included in plan.') }}>
          <fieldset disabled={!focus.ready || feedback.busy} className="space-y-3"><Field label={`Existing open work for ${plan.data.title}`}><select required defaultValue="" name="planItemId" className={selectClass}><option value="" disabled>Choose existing work</option>{candidates.map((item) => <option key={item.recordId} value={item.recordId}>{item.data.intent} · {areas.records.find((area) => area.recordId === item.data.prepAreaId)?.data.name ?? 'Prep Area'} · {itemMemberships(plans.records, item.recordId).map((row) => row.data.title).join(', ') || 'Outside plans'}</option>)}</select></Field><Button type="submit" disabled={!candidates.length}>Include existing work</Button></fieldset>
        </form>
      </Section>
      <Button variant="secondary" disabled={!focus.ready || feedback.busy} onClick={() => void feedback.save(async () => { await runPrepAction('closePlan', { planId: plan.recordId }) }, 'Plan closed. Its membership is preserved.')}>Close plan</Button>
    </>}
    {plan.data.closedAt && <p>Unfinished work can start or resume outside this closed plan, or be included in another open plan. Return to <Link to="/home" className="underline">Home</Link> for Current Focus.</p>}
  </div>
}
