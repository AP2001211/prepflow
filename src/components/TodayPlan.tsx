import { PlanBuildLink } from './PlanBuildAction'
import { displayDate } from '../lib/display-date'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { Plan, PrepArea } from '../schemas/prep-schema'
import { todayPlans } from '../lib/plan-date'
import { useFocus } from './FocusController'
import { Button } from './ui'

export function TodayPlan({ planDate }: { planDate: string }) {
  const plans = useQuery<Plan>('plans', { where: { planDate } })
  const areas = useQuery<PrepArea>('prep-areas')
  const focus = useFocus()
  const navigate = useNavigate()
  const matches = todayPlans(plans.records, planDate)
  const plan = matches.length === 1 ? matches[0] : undefined
  return <section aria-label="Today's Plan" className={plan ? `today-plan${focus.active.length ? ' today-plan-subordinate' : ''}` : `plan-invitation${focus.active.length ? ' plan-invitation-subordinate' : ''}`}>
    <div className="today-heading"><p className="eyebrow">Today’s Plan</p><p className="today-date">{displayDate(planDate)}</p></div>
    {plans.status === 'loading' && <p role="status">Loading today’s plan…</p>}
    {plans.error && <p role="alert">Could not load today’s plan. Reload to retry.</p>}
    {matches.length > 1 && <p role="alert">More than one plan exists for this date. Open Plans to inspect them; no plan was selected automatically.</p>}
    {plan ? <>
      <h2 className="display-title break-words">{plan.data.title}</h2>
      <p className="plan-facts">{plan.data.planItemIds.filter((id) => focus.items.records.find((item) => item.recordId === id)?.data.status === 'completed').length} of {plan.data.planItemIds.length} complete{plan.data.budgetMinutes ? ` · ${plan.data.budgetMinutes} minute budget` : ''} · {plan.data.planItemIds.length} {plan.data.planItemIds.length === 1 ? 'item' : 'items'}</p>
      <ol className="today-work-surface">{plan.data.planItemIds.map((id, index) => {
        const item = focus.items.records.find((row) => row.recordId === id)
        const resumed = focus.sessions.records.some((row) => row.data.planItemId === id && row.data.state === 'ended')
        return <li key={id} className="today-work-row"><span className="work-number">{item?.data.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span><div className="min-w-0 flex-1"><h3 className="font-medium break-words">{item?.data.intent ?? 'Loading intended work…'}</h3><p className="text-sm text-muted-foreground">{areas.records.find((area) => area.recordId === item?.data.prepAreaId)?.data.name ?? 'Prep Area'}{item?.data.status === 'completed' ? ' · Completed' : focus.active.some((row) => row.data.planItemId === id) ? ' · In focus' : ''}</p></div>
          {item?.data.status !== 'completed' && item && !plan.data.closedAt && <Button size="sm" variant="outline" disabled={!focus.canStart || focus.pendingIds.has(id)} onClick={() => void focus.start(id, plan.recordId).then((accepted) => { if (accepted) navigate('/focus') })}>{resumed ? 'Resume' : 'Start'}</Button>}
        </li>
      })}</ol>
      {focus.loaded && plan.data.planItemIds.length > 0 && plan.data.planItemIds.every((id) => focus.items.records.find((item) => item.recordId === id)?.data.status === 'completed') && <p className="plan-facts">A good day’s work. Your plan stays here for today.</p>}
      <Link className="quiet-link plan-detail-link" to={`/plans/${plan.recordId}`}>View plan details →</Link>
    </> : plans.status === 'ready' && !plans.error && !matches.length && <>
      <h2 className="display-title">{focus.active.length ? 'Plan the rest of your day.' : <>A little direction.<br />A focused day.</>}</h2>
      <p className="invitation-copy">{focus.active.length ? 'Choose a small commitment for today.' : 'Turn the time you have into a small preparation plan. Get a suggestion from your real work, then choose what to commit to.'}</p>
      <PlanBuildLink to="/plans/suggest?mode=daily">Build today’s plan</PlanBuildLink>
      {!focus.active.length && <p className="invitation-assurance">You review every suggestion before anything is saved.</p>}
    </>}
  </section>
}
