import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { Plan } from '../schemas/prep-schema'
import { relevantPlan } from '../lib/plans'
import { useFocus } from './FocusController'
import { Button } from './ui'
import { Field, Section, selectClass, dateTime } from './prep-ui'

export function PlanSummary() {
  const plans = useQuery<Plan>('plans', { orderBy: 'createdAt', orderDir: 'desc' })
  const focus = useFocus()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer) }, [])
  const [selection, setSelection] = useState('')
  const [changing, setChanging] = useState(false)
  const openPlans = plans.records.filter((row) => !row.data.closedAt)
  const plan = openPlans.find((row) => row.recordId === selection) ?? relevantPlan(plans.records, focus.active, now)
  const openItems = plan?.data.planItemIds.map((id) => focus.items.records.find((item) => item.recordId === id)).filter((item) => item?.data.status === 'open') ?? []
  return <Section title="Relevant Plan">
    {plans.status === 'loading' && <p>Loading plans…</p>}{plans.error && <p role="alert">Could not load plans.</p>}
    {plan ? <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold break-words">{plan.data.title}</h3>{openPlans.length > 1 && <Button variant="ghost" onClick={() => setChanging(!changing)} aria-expanded={changing}>Change</Button>}</div>
      {changing && <Field label="Choose a plan"><select value={selection} onChange={(event) => { setSelection(event.target.value); setChanging(false) }} className={selectClass}><option value="">Default plan</option>{openPlans.map((row) => <option key={row.recordId} value={row.recordId}>{row.data.title}</option>)}</select></Field>}
      <p className="text-sm">{plan.data.planItemIds.filter((id) => focus.items.records.find((item) => item.recordId === id)?.data.status === 'completed').length} of {plan.data.planItemIds.length} completed{plan.data.closedAt ? ' · Closed plan' : ''}</p>
      {plan.data.budgetMinutes && <p className="text-sm">{plan.data.budgetMinutes} minute budget</p>}
      {(plan.data.startsAt || plan.data.endsAt) && <p className="text-sm text-muted-foreground">{plan.data.startsAt ? `From ${dateTime(plan.data.startsAt)}` : ''}{plan.data.startsAt && plan.data.endsAt ? ' · ' : ''}{plan.data.endsAt ? `Until ${dateTime(plan.data.endsAt)}` : ''}</p>}
      <ul className="space-y-2">{openItems.slice(0, 3).map((item) => item && <li key={item.recordId} className="flex flex-wrap items-center gap-2"><span className="break-words">{item.data.intent}</span>{!plan.data.closedAt && <Button variant="secondary" disabled={!focus.canStart || focus.pendingIds.has(item.recordId)} onClick={() => void focus.start(item.recordId, plan.recordId)}>{focus.sessions.records.some((row) => row.data.planItemId === item.recordId && row.data.state === 'ended') ? 'Resume' : 'Start'}</Button>}</li>)}</ul>
      <Link to={`/plans/${plan.recordId}`} className="inline-block underline">View plan →</Link>
    </div> : plans.status === 'ready' && <p>No open plans. General preparation works without one. <Link to="/plans" className="underline">Create a plan</Link></p>}
  </Section>
}
