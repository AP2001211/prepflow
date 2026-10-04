import { PlanBuildLink } from './PlanBuildAction'
import { displayDate } from '../lib/display-date'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { Plan, PrepArea } from '../schemas/prep-schema'
import { dailyPlanState } from '../lib/plan-date'
import { useFocus } from './FocusController'
import { Button } from './ui'

export function TodayPlan({ planDate }: { planDate: string }) {
  const plans = useQuery<Plan>('plans', { where: { planDate }, limit: 500 })
  const areas = useQuery<PrepArea>('prep-areas')
  const focus = useFocus()
  const ready = plans.status === 'ready' && !plans.error && plans.records.length < 500 && focus.loaded
  const daily = dailyPlanState(plans.records, focus.items.records, planDate, ready)
  const plan = daily.displayPlan
  const earlier = daily.completedEarlierPlans
  const plannedMinutes = earlier.reduce((sum, row) => sum + (row.data.budgetMinutes ?? 0), 0)
  const hasEarlierBudget = earlier.some((row) => row.data.budgetMinutes != null)
  return <section aria-label="Today's Plan" className={plan ? `today-plan${focus.active.length ? ' today-plan-subordinate' : ''}` : `plan-invitation${focus.active.length ? ' plan-invitation-subordinate' : ''}`}>
    <div className="today-heading"><p className="eyebrow">Today’s Plan</p><p className="today-date">{displayDate(planDate)}</p></div>
    {!ready && !plans.error && <p role="status">Loading today’s plan…</p>}
    {plans.records.length >= 500 && <p role="alert">Too many plans to fully check today. Open Plans to inspect them.</p>}
    {plans.error && <p role="alert">Could not load today’s plan. Reload to retry.</p>}
    {daily.conflict && <p role="alert">Multiple incomplete plans exist for today. <Link to="/plans">Open Plans to inspect them</Link>; no plan was selected automatically.</p>}
    {plan ? <>
      <h2 className="display-title break-words">{plan.data.title}</h2>
      <p className="plan-facts">{plan.data.planItemIds.filter((id) => focus.items.records.find((item) => item.recordId === id)?.data.status === 'completed').length} of {plan.data.planItemIds.length} complete{plan.data.budgetMinutes ? ` · ${plan.data.budgetMinutes} minute budget` : ''} · {plan.data.planItemIds.length} {plan.data.planItemIds.length === 1 ? 'item' : 'items'}</p>
      <ol className="today-work-surface">{plan.data.planItemIds.map((id, index) => {
        const item = focus.items.records.find((row) => row.recordId === id)
        const resumed = focus.sessions.records.some((row) => row.data.planItemId === id && row.data.state === 'ended')
        return <li key={id} className="today-work-row"><span className="work-number">{item?.data.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span><div className="min-w-0 flex-1"><h3 className="font-medium break-words">{item?.data.intent ?? 'Loading intended work…'}</h3><p className="text-sm text-muted-foreground">{areas.records.find((area) => area.recordId === item?.data.prepAreaId)?.data.name ?? 'Prep Area'}{item?.data.status === 'completed' ? ' · Completed' : focus.active.some((row) => row.data.planItemId === id) ? ' · In focus' : ''}</p></div>
          {item?.data.status !== 'completed' && item && !plan.data.closedAt && <Button size="sm" variant="outline" disabled={!focus.canStart || focus.pendingIds.has(id)} onClick={() => void focus.start(id, plan.recordId)}>{resumed ? 'Resume' : 'Start'}</Button>}
        </li>
      })}</ol>
      {focus.loaded && plan.data.planItemIds.length > 0 && plan.data.planItemIds.every((id) => focus.items.records.find((item) => item.recordId === id)?.data.status === 'completed') && <p className="plan-facts">A good day’s work. Your plan stays here for today.</p>}
      {daily.planningAllowed && <PlanBuildLink to="/plans/suggest?mode=daily">Build another plan</PlanBuildLink>}
      <Link className="quiet-link plan-detail-link" to={`/plans/${plan.recordId}`}>View plan details →</Link>
    </> : daily.planningAllowed && !daily.matches.length && <>
      <div className="today-invitation-composition"><div className="today-invitation-copy">
      <h2 className="display-title">{focus.active.length ? 'Plan the rest of your day.' : <>A little direction.<br />A focused day.</>}</h2>
      <p className="invitation-copy">{focus.active.length ? 'Choose a small commitment for today.' : 'Turn the time you have into a small preparation plan. Get a suggestion from your real work, then choose what to commit to.'}</p>
      </div>{!focus.active.length && <img className="today-planner-illustration" src="/images/illustrations/planner.png" width="800" height="800" alt="" aria-hidden="true" />}
      </div>
      <PlanBuildLink to="/plans/suggest?mode=daily">Build today’s plan</PlanBuildLink>
      {!focus.active.length && <p className="invitation-assurance">You review every suggestion before anything is saved.</p>}
    </>}
    {earlier.length > 0 && <details className="today-completed-earlier">
      <summary>Completed earlier today · {earlier.length} {earlier.length === 1 ? 'plan' : 'plans'}{hasEarlierBudget ? ` · ${plannedMinutes} min planned` : ''}</summary>
      <ul>{earlier.map((row) => <li key={row.recordId}>
        <span className="today-completed-check" aria-hidden="true">✓</span>
        <div className="min-w-0"><h3>{row.data.title}</h3><p>{row.data.planItemIds.length} of {row.data.planItemIds.length} completed{row.data.budgetMinutes != null ? ` · ${row.data.budgetMinutes} min planned` : ''}</p>
          <Link className="quiet-link" to={`/plans/${row.recordId}`} aria-label={`View plan details for ${row.data.title}`}>View plan details →</Link>
        </div>
      </li>)}</ul>
    </details>}
  </section>
}
