import { displayDate } from '../../../../lib/display-date'
import { PlanBuildButton } from '../../../../components/PlanBuildAction'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { useLocalDay } from '../../../../lib/use-local-day'
import { dailyPlanState } from '../../../../lib/plan-date'
import type { DailyContext } from '../../../../actions/daily-plan'
import type { Plan, PrepArea } from '../../../../schemas/prep-schema'
import type { PlannerResponse } from '../../../../ai/planner-contract'
import { requestPrepPlan } from '../../../../lib/planner'
import { runPrepAction } from '../../../../lib/prep-actions'
import { useFocus } from '../../../../components/FocusController'
import { PlannerSuggestion } from '../../../../components/PlannerSuggestion'
import { Field } from '../../../../components/prep-ui'
import { Button, Input, Textarea } from '../../../../components/ui'

type ReviewedContext = { mode: 'daily'; daily: DailyContext } | { mode: 'generic'; daily?: never }

export default function SuggestPlanPage() {
  const [search] = useSearchParams()
  // An undated Plan is deliberate, never a fallback for a missing daily flag.
  const dailyMode = search.get('mode') !== 'generic'
  const day = useLocalDay()
  const plans = useQuery<Plan>('plans', { where: { planDate: day.planDate }, limit: 500 })
  const areas = useQuery<PrepArea>('prep-areas')
  const focus = useFocus()
  const daily = dailyPlanState(plans.records, focus.items.records, day.planDate, plans.status === 'ready' && !plans.error && plans.records.length < 500 && focus.loaded)
  const navigate = useNavigate()
  const [minutes, setMinutes] = useState('30')
  const [customMinutes, setCustomMinutes] = useState(false)
  const [goal, setGoal] = useState('')
  const [review, setReview] = useState<({ result: PlannerResponse; requestId: string } & ReviewedContext) | null>(null)
  const [busy, setBusy] = useState<'generation' | 'acceptance' | null>(null)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const accepting = useRef(false)
  useEffect(() => () => controller.current?.abort(), [])
  const hasAreas = areas.status === 'ready' && areas.records.length > 0
  async function generate() {
    if (controller.current || accepting.current || !hasAreas || (dailyMode && !daily.planningAllowed)) return
    const context: ReviewedContext = dailyMode ? { mode: 'daily', daily: { ...day } } : { mode: 'generic' }
    const abort = new AbortController(); controller.current = abort
    setBusy('generation'); setError(''); setReview(null)
    try {
      const result = await requestPrepPlan({ availableMinutes: Number(minutes), ...(context.mode === 'daily' ? { timeZone: context.daily.timeZone } : {}), ...(goal.trim() ? { goal: goal.trim() } : {}) }, abort.signal)
      if (!abort.signal.aborted) setReview({ result: structuredClone(result), requestId: crypto.randomUUID(), ...context })
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Planning failed. Please retry.') }
    finally { if (controller.current === abort) { controller.current = null; setBusy(null) } }
  }
  async function accept() {
    if (!review || accepting.current || controller.current) return
    accepting.current = true; setBusy('acceptance'); setError('')
    try {
      const id = await runPrepAction('acceptPrepPlan', { requestId: review.requestId, availableMinutes: review.result.availableMinutes, recommendation: review.result.recommendation, ...(review.mode === 'daily' ? { daily: review.daily } : {}) })
      navigate(`/plans/${id}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the plan. Retry Use this plan.') }
    finally { accepting.current = false; setBusy(null) }
  }
  return <div className="plans-flow planner-page">
    <Link to="/plans" className="underline">Back to Plans</Link>
    <h1 className="display-heading">{dailyMode ? "Build today’s plan" : 'Help me plan'}</h1>
    {dailyMode && <p className="eyebrow">Today · {displayDate(day.planDate, true)}</p>}
    {dailyMode && daily.currentPlan && <p>Today’s plan still has unfinished work. <Link className="underline" to={`/plans/${daily.currentPlan.recordId}`}>View plan</Link></p>}
    {dailyMode && daily.conflict && <p role="alert">Multiple incomplete plans exist for today. <Link to="/plans">Open Plans to inspect them.</Link></p>}
    {dailyMode && plans.records.length >= 500 && <p role="alert">Too many plans to fully check today. Planning remains unavailable.</p>}
    {dailyMode && plans.error && <p role="alert">Could not load today’s plans. Reload to retry.</p>}
    <p>A bounded plan, built from your Prep Areas, unfinished work, and interview preparation. You review it before anything is saved.</p>
    {areas.status === 'loading' && <p>Loading your Prep Areas…</p>}
    {areas.error && <p role="alert">Could not load Prep Areas. Reload to retry.</p>}
    {areas.status === 'ready' && !hasAreas && <p>Create a Prep Area in <Link to="/prep" className="underline">My Prep</Link> before building a plan. An interview is optional.</p>}
    {hasAreas && (!dailyMode || daily.planningAllowed) && <form onSubmit={(event) => { event.preventDefault(); void generate() }} className="planner-form">
      <fieldset disabled={busy !== null} className="space-y-3">
        <legend className="text-xl font-semibold">How much time do you have?</legend>
        <div className="duration-options" role="group" aria-label="Available time">{[['30', '30 min'], ['60', '60 min'], ['90', '90 min'], ['120', '2 hours']].map(([value, label]) => <button type="button" key={value} aria-pressed={!customMinutes && minutes === value} onClick={() => { setMinutes(value!); setCustomMinutes(false) }}>{label}</button>)}<button type="button" aria-pressed={customMinutes} onClick={() => setCustomMinutes(true)}>Custom</button></div>
        {customMinutes && <Field label="Available minutes"><Input type="number" min={1} max={1440} step={1} required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></Field>}
        <Field label="Goal (optional)"><Textarea maxLength={2000} value={goal} onChange={(event) => setGoal(event.target.value)} /></Field>
        <PlanBuildButton type="submit" disabled={busy !== null}>Build my plan</PlanBuildButton>
      </fieldset>
    </form>}
    {busy === 'generation' && <div role="status">Building your plan… <Button variant="secondary" onClick={() => controller.current?.abort()}>Cancel</Button></div>}
    {error && <p role="alert">{error}</p>}
    {review && <>{review.daily && <p>Reviewed for {displayDate(review.daily.planDate)}</p>}{review.daily && (review.daily.planDate !== day.planDate || review.daily.timeZone !== day.timeZone) && <div role="alert"><p>Your local day or timezone changed. This suggestion has not been rescheduled.</p><Button variant="outline" disabled={busy !== null} onClick={() => setReview({ ...review, daily: { ...day } })}>Review this suggestion for {displayDate(day.planDate)}</Button></div>}<PlannerSuggestion result={review.result} /><div className="planner-review-decision"><div><p className="planner-decision-total">{review.result.totalMinutes} min total</p><p className="planner-review-help">Use this plan saves the reviewed work in order. It will not start focus.</p></div><Button disabled={busy !== null || !focus.ready} onClick={() => void accept()}>{busy === 'acceptance' ? 'Saving plan…' : 'Use this plan'}</Button></div></>}
  </div>
}
