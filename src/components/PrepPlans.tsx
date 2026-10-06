import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { PrepPlan, Interview, PrepArea } from '../schemas/prep-schema'

export function PrepPlans() {
  const plans = useQuery<PrepPlan>('prep-plans', { orderBy: 'createdAt', orderDir: 'desc' })
  const interviews = useQuery<Interview>('interviews')
  const areas = useQuery<PrepArea>('prep-areas')
  return <section className="prep-plans-section" aria-label="Prep Plans">
    <header><div><h2>Prep Plans</h2><p className="text-muted-foreground">What matters for your interview or preparation goal.</p></div></header>
    {plans.status !== 'ready' && !plans.error && <p role="status">Loading prep plans…</p>}{plans.error && <p role="alert">Could not load prep plans.</p>}
    {plans.status === 'ready' && !plans.error && !plans.records.length && <p className="text-muted-foreground">Keep your preparation focus in one place. Daily Plans turn it into work for a day.</p>}
    <ul className="prep-plan-cards">{plans.records.map((plan) => {
      const interview = interviews.records.find((row) => row.recordId === plan.data.interviewId)
      return <li key={plan.recordId}><Link to={`/plans/prep/${plan.recordId}`}><h3>{plan.data.title}</h3><p>{plan.data.interviewId ? interview ? [interview.data.company, interview.data.role].filter(Boolean).join(' · ') : 'Interview unavailable' : plan.data.goal}</p>{plan.data.prepAreaIds.length > 0 && <p className="text-sm text-muted-foreground">{plan.data.prepAreaIds.map((id) => areas.records.find((row) => row.recordId === id)?.data.name ?? 'Unavailable Prep Area').join(' · ')}</p>}</Link></li>
    })}</ul>
    <div className="prep-plans-create"><Link className="plans-extend-action" to="/plans/prep/new">Create Prep Plan</Link></div>
  </section>
}
