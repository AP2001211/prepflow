import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { Plan } from '../../../../schemas/prep-schema'
import { useFocus } from '../../../../components/FocusController'
import { WorkItemRow } from '../../../../components/WorkItemRow'
import { PlansCalendar } from '../../../../components/PlansCalendar'
import { unfinishedWork } from '../../../../lib/plans'
import { validPlanDate, dailyPlanningAccess } from '../../../../lib/plan-date'
import { useLocalDay } from '../../../../lib/use-local-day'
import { displayDate } from '../../../../lib/display-date'
import { Button } from '../../../../components/ui'

export default function PlansPage() {
  const plans = useQuery<Plan>('plans', { orderBy: 'createdAt', orderDir: 'desc' })
  const focus = useFocus()
  const { planDate: today } = useLocalDay()
  const [search, setSearch] = useSearchParams()
  const requestedDate = search.get('date')
  const selected = requestedDate && validPlanDate(requestedDate) ? requestedDate : today
  const setSelected = (date: string) => setSearch({ date }, { replace: true })
  const [month, setMonth] = useState(selected.slice(0, 7))
  const [count, setCount] = useState(10)
  const unfinished = unfinishedWork(focus.items.records)
  const { hash } = useLocation()
  const disclosure = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (hash === '#unfinished-work' && disclosure.current) {
      disclosure.current.open = true
      disclosure.current.scrollIntoView({ block: 'start' })
    }
  }, [hash, focus.loaded, plans.status])
  const legacy = plans.records.filter((plan) => !plan.data.planDate)
  const dated = plans.records.filter((plan) => plan.data.planDate === selected)
  const access = dailyPlanningAccess(plans.records, focus.items.records, selected, plans.status === 'ready' && focus.loaded)
  const dates = new Set(plans.records.flatMap((plan) => plan.data.planDate && validPlanDate(plan.data.planDate) ? [plan.data.planDate] : []))
  return <div className="plans-flow plans-index">
    <header className="plans-index-heading"><h1>Plans</h1><Link to="/home">Back to Home</Link></header>
    <section aria-label="Daily Plans">
      <h2 className="plans-horizon-heading">Daily Plans</h2>
      <div className="plans-index-workspace">
        <section className="plans-selected-day" aria-label="Selected day">
          <p className="eyebrow">{selected === today ? `Today · ${displayDate(selected).split(', ').slice(1).join(', ')}` : displayDate(selected)}</p>
          {plans.status === 'loading' && <p role="status">Loading plans…</p>}
          {plans.error && <p role="alert">Could not load plans.</p>}
          {plans.status === 'ready' && !plans.error && !dated.length && <div className="plans-day-empty"><h2>{selected < today ? 'Nothing was planned for this day.' : selected === today ? 'Nothing planned for today yet.' : 'Nothing planned for this day yet.'}</h2>{selected === today && <Link className="plans-day-build" to="/plans/suggest?mode=daily">Build today’s plan →</Link>}{selected > today && <Link className="plans-day-build" to={`/plans/suggest?mode=daily&planDate=${selected}`}>Plan this day →</Link>}</div>}
          {selected >= today && access.conflict && <p role="alert">Multiple daily plans exist for this date. Planning is unavailable.</p>}
          {dated.map((plan) => <article key={plan.recordId} className="plans-day-plan">
            <h2>{plan.data.title}</h2>
            <p className="plans-day-facts">{plan.data.planItemIds.filter((id) => focus.items.records.find((item) => item.recordId === id)?.data.status === 'completed').length} of {plan.data.planItemIds.length} activities completed{plan.data.budgetMinutes != null ? ` · ${plan.data.budgetMinutes} min planned` : ''}</p>
            <p className="text-sm text-muted-foreground">{plan.data.closedAt && 'Closed · '}<Link className="underline" to={`/plans/${plan.recordId}`}>View plan details</Link></p>
            {!focus.loaded && <p role="status">Loading intended work…</p>}
            <ol className="plans-day-items">{plan.data.planItemIds.map((id) => {
              const item = focus.items.records.find((row) => row.recordId === id)
              return <li key={id}>{item ? <WorkItemRow compact item={item} plans={plans.records} plan={plan} /> : 'Intended work unavailable'}</li>
            })}</ol>
          </article>)}
          {selected >= today && access.plan && access.planningAllowed && <Link className="plans-extend-action" to={`/plans/suggest?mode=daily&planDate=${selected}`}>{selected === today ? "Add to today's plan" : 'Add to this plan'}</Link>}
        </section>
        <PlansCalendar month={month} selected={selected} today={today} dates={dates} onMonth={setMonth} onSelect={setSelected} />
      </div>
    </section>
    <div className="plans-secondary">
      <details id="unfinished-work" ref={disclosure}><summary>All unfinished work</summary><h2 className="text-xl font-semibold">Unfinished Work</h2><p className="text-sm text-muted-foreground">Open work across dates, including multiple or closed plans. Each item appears once.</p>{focus.loaded && !unfinished.length && <p>No unfinished work.</p>}<ul className="space-y-4">{unfinished.slice(0, count).map((item) => <li key={item.recordId}><WorkItemRow item={item} plans={plans.records} /></li>)}</ul>{unfinished.length > count && <Button variant="secondary" onClick={() => setCount(count + 10)}>Show more unfinished work</Button>}</details>
      {legacy.length > 0 && <details><summary>Earlier plan records</summary><ul className="space-y-3">{legacy.map((plan) => <li key={plan.recordId}><Link className="underline break-words" to={`/plans/${plan.recordId}`}>{plan.data.title}</Link></li>)}</ul></details>}
    </div>
  </div>
}
