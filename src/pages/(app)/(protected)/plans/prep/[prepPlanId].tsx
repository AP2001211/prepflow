import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { PrepPlan, PrepArea, Interview } from '../../../../../schemas/prep-schema'
import { PrepPlanForm } from '../../../../../components/PrepPlanForm'
import { Button } from '../../../../../components/ui'
import { displayDate } from '../../../../../lib/display-date'

export default function PrepPlanDetailPage() {
  const { prepPlanId } = useParams()
  const plans = useQuery<PrepPlan>('prep-plans')
  const areas = useQuery<PrepArea>('prep-areas')
  const interviews = useQuery<Interview>('interviews')
  const [editing, setEditing] = useState(false)
  const plan = plans.records.find((row) => row.recordId === prepPlanId)
  if (plans.status !== 'ready' || plans.error) return <div className="plans-flow prep-plan-page"><p role={plans.error ? 'alert' : 'status'}>{plans.error ? 'Could not load this prep plan.' : 'Loading prep plan…'}</p><Link to="/prep">Back to My Prep</Link></div>
  if (!plan) return <div className="plans-flow prep-plan-page"><p role="alert">Prep plan unavailable.</p><Link to="/prep">Back to My Prep</Link></div>
  const interview = interviews.records.find((row) => row.recordId === plan.data.interviewId)
  return <div className="plans-flow prep-plan-page"><Link className="underline" to="/prep">Back to My Prep</Link><p className="eyebrow">Prep Plan</p><h1>{plan.data.title}</h1>
    {plan.data.interviewId ? <p>{interview ? [interview.data.company, interview.data.role, interview.data.stage, interview.data.scheduledDate ? displayDate(interview.data.scheduledDate) : ''].filter(Boolean).join(' · ') : interviews.status !== 'ready' ? 'Loading interview…' : 'Interview unavailable'}</p> : <p>{plan.data.goal}</p>}
    {editing ? <PrepPlanForm key={plan.recordId} plan={plan.data} planId={plan.recordId} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} /> : <>
      <section><h2>Preparing for</h2><p>{plan.data.prepAreaIds.length ? plan.data.prepAreaIds.map((id) => areas.records.find((row) => row.recordId === id)?.data.name ?? 'Unavailable Prep Area').join(' · ') : 'No prep areas selected yet.'}</p></section>
      <section><h2>Preparation focus</h2><p className="whitespace-pre-wrap">{plan.data.context}</p></section><Button variant="secondary" onClick={() => setEditing(true)}>Edit prep plan</Button>
    </>}
  </div>
}
