import { Link, useParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { Plan, PrepArea } from '../../../../schemas/prep-schema'
import { useFocus } from '../../../../components/FocusController'
import { Section, dateTime } from '../../../../components/prep-ui'
import { WorkItemRow } from '../../../../components/WorkItemRow'

export default function PlanDetailPage() {
  const { planId } = useParams()
  const plans = useQuery<Plan>('plans', { orderBy: 'createdAt', orderDir: 'desc' })
  const areas = useQuery<PrepArea>('prep-areas')
  const focus = useFocus()
  const plan = plans.records.find((row) => row.recordId === planId)
  if (plans.status !== 'ready') return <p className="plans-flow p-5" role={plans.error ? 'alert' : 'status'}>{plans.error ? 'Could not load this plan.' : 'Loading plan…'}</p>
  if (!plan) return <div className="plans-flow p-5"><p role="alert">Plan unavailable.</p><Link to="/plans" className="underline">Back to Plans</Link></div>
  return <div className="plans-flow mx-auto max-w-5xl space-y-6 px-5 py-8">
    <Link to="/plans" className="underline">Back to Plans</Link>
    <h1 className="text-3xl font-semibold break-words">{plan.data.title}</h1>
    {plan.data.planDate && <p className="eyebrow">Daily Plan · {plan.data.planDate}</p>}
    <p>{plan.data.closedAt ? `Closed ${dateTime(plan.data.closedAt)} — membership is fixed` : 'Open plan'}{plan.data.budgetMinutes ? ` · ${plan.data.budgetMinutes} minute budget` : ''}{plan.data.startsAt ? ` · From ${dateTime(plan.data.startsAt)}` : ''}{plan.data.endsAt ? ` · Until ${dateTime(plan.data.endsAt)}` : ''}</p>
    <Section title="Intended Work">
      {!plan.data.planItemIds.length && <p>No intended work in this record.</p>}
      <ol className="list-inside list-decimal space-y-4">{plan.data.planItemIds.map((id) => { const item = focus.items.records.find((row) => row.recordId === id); return <li key={id}>{item ? <WorkItemRow item={item} plans={plans.records} plan={plan} /> : 'Intended work unavailable'}</li> })}</ol>
    </Section>
    {plan.data.closedAt && <p>Unfinished work can start or resume outside this closed plan. Return to <Link to="/home" className="underline">Home</Link> for Current Focus.</p>}
  </div>
}
