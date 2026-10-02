import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { Plan } from '../../../../schemas/prep-schema'
import { useFocus } from '../../../../components/FocusController'
import { Section } from '../../../../components/prep-ui'
import { PlanCreateForm } from '../../../../components/PlanCreateForm'
import { WorkItemRow } from '../../../../components/WorkItemRow'
import { unfinishedWork } from '../../../../lib/plans'
import { Button } from '../../../../components/ui'

export default function PlansPage() {
  const plans = useQuery<Plan>('plans', { orderBy: 'createdAt', orderDir: 'desc' })
  const focus = useFocus()
  const [count, setCount] = useState(10)
  const unfinished = unfinishedWork(focus.items.records)
  const { hash } = useLocation()
  useEffect(() => {
    if (hash === '#unfinished-work') document.getElementById('unfinished-work')?.scrollIntoView({ block: 'start' })
  }, [hash, focus.loaded, plans.status])
  return <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
    <h1 className="text-3xl font-semibold">Plans</h1>
    <Link to="/home" className="inline-block underline">Back to Current Focus</Link>
    <Link to="/plans/suggest" className="inline-block underline">Help me plan</Link>
    <Section title="Your Plans">
      {plans.status === 'loading' && <p>Loading plans…</p>}{plans.error && <p role="alert">Could not load plans.</p>}
      {plans.status === 'ready' && !plans.records.length && <p>No plans yet. Plans can span hours, days, or weeks.</p>}
      <ul className="space-y-4">{plans.records.slice(0, count).map((plan) => <li key={plan.recordId}><Link className="font-medium underline break-words" to={`/plans/${plan.recordId}`}>{plan.data.title}</Link><p className="text-sm">{plan.data.closedAt ? 'Closed' : 'Open'} · {plan.data.planItemIds.length} intended activities · {plan.data.planItemIds.filter((id) => focus.items.records.find((item) => item.recordId === id)?.data.status === 'completed').length} completed</p></li>)}</ul>
      {plans.records.length > count && <Button variant="secondary" className="mt-3" onClick={() => setCount(count + 10)}>Show more plans</Button>}
    </Section>
    <section id="unfinished-work" className="scroll-mt-4 rounded-lg border border-border p-5">
      <h2 className="mb-4 text-xl font-semibold">Unfinished Work</h2>
      <p className="mb-4 text-sm text-muted-foreground">All your open work, including items in multiple or closed plans. Each item appears once.</p>
      {focus.loaded && !unfinished.length && <p>No unfinished work.</p>}
      <ul className="space-y-4">{unfinished.slice(0, count).map((item) => <li key={item.recordId}><WorkItemRow item={item} plans={plans.records} /></li>)}</ul>
      {unfinished.length > count && <Button variant="secondary" className="mt-3" onClick={() => setCount(count + 10)}>Show more unfinished work</Button>}
    </section>
    <Section title="Create a Plan"><PlanCreateForm /></Section>
  </div>
}
