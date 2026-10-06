import { displayDate } from '../../../../lib/display-date'
import { PlanBuildButton } from '../../../../components/PlanBuildAction'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { useLocalDay } from '../../../../lib/use-local-day'
import { dailyPlanningAccess, validPlanDate } from '../../../../lib/plan-date'
import type { DailyContext } from '../../../../actions/daily-plan'
import type { Plan, PrepArea } from '../../../../schemas/prep-schema'
import type { PlannerResponse } from '../../../../ai/planner-contract'
import { requestPrepPlan } from '../../../../lib/planner'
import { runPrepAction } from '../../../../lib/prep-actions'
import { useFocus } from '../../../../components/FocusController'
import { PlannerSuggestion, PlannerCoverage } from '../../../../components/PlannerSuggestion'
import { Field } from '../../../../components/prep-ui'
import { Button, Input, Textarea } from '../../../../components/ui'

type ReviewedContext = { mode: 'daily'; daily: DailyContext } | { mode: 'generic'; daily?: never }

export default function SuggestPlanPage() {
  const [search] = useSearchParams()
  if (search.get('mode') === 'generic') return <div className="plans-flow prep-plan-page"><h1>This planning mode is no longer available</h1><p>Use Daily Plans for work on a date, or create a Prep Plan for your preparation focus.</p><Link className="underline" to="/plans">Back to Plans</Link></div>
  return <DailySuggestPlanPage />
}

function DailySuggestPlanPage() {
  const [search] = useSearchParams()
  // An undated Plan is deliberate, never a fallback for a missing daily flag.
  const dailyMode = search.get('mode') !== 'generic'
  const day = useLocalDay()
  const explicitTarget = dailyMode && search.has('planDate')
  const targetDate = explicitTarget ? search.get('planDate')! : day.planDate
  const targetValid = validPlanDate(targetDate) && targetDate >= day.planDate
  const target = { planDate: targetDate, timeZone: day.timeZone }
  const plans = useQuery<Plan>('plans', { where: { planDate: targetDate }, limit: 500 })
  const areas = useQuery<PrepArea>('prep-areas')
  const focus = useFocus()
  const daily = dailyPlanningAccess(plans.records, focus.items.records, targetDate, plans.status === 'ready' && !plans.error && plans.records.length < 500 && focus.loaded)
  const navigate = useNavigate()
  const [editingInputs, setEditingInputs] = useState(false)
  const [minutes, setMinutes] = useState('30')
  const [customMinutes, setCustomMinutes] = useState(false)
  const [goal, setGoal] = useState('')
  const [review, setReview] = useState<({ result: PlannerResponse; requestId: string; reviewedLocalDate: string } & ReviewedContext) | null>(null)
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [selectionFrozen, setSelectionFrozen] = useState(false)
  const [busy, setBusy] = useState<'generation' | 'acceptance' | null>(null)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const accepting = useRef(false)
  useEffect(() => () => controller.current?.abort(), [])
  const hasAreas = areas.status === 'ready' && areas.records.length > 0
  async function generate() {
    if (controller.current || accepting.current || !hasAreas || (dailyMode && !targetValid) || (dailyMode && !daily.planningAllowed)) return
    const context: ReviewedContext = dailyMode ? { mode: 'daily', daily: { ...target } } : { mode: 'generic' }
    const abort = new AbortController(); controller.current = abort
    setSelectionFrozen(false); setBusy('generation'); setError(''); setReview(null)
    try {
      const result = await requestPrepPlan({ availableMinutes: Number(minutes), ...(context.mode === 'daily' ? { timeZone: context.daily.timeZone, planDate: context.daily.planDate } : {}), ...(goal.trim() ? { goal: goal.trim() } : {}) }, abort.signal)
      if (!abort.signal.aborted) { setEditingInputs(false); setSelectedIndices(result.recommendation.items.map((_, index) => index)); setReview({ result: structuredClone(result), requestId: crypto.randomUUID(), reviewedLocalDate: day.planDate, ...context }) }
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Planning failed. Please retry.') }
    finally { if (controller.current === abort) { controller.current = null; setBusy(null) } }
  }
  async function accept() {
    if (!review || !selectedIndices.length || (review.daily && (review.daily.timeZone !== day.timeZone || review.reviewedLocalDate !== day.planDate)) || accepting.current || controller.current) return
    setSelectionFrozen(true); accepting.current = true; setBusy('acceptance'); setError('')
    try {
      const id = await runPrepAction('acceptPrepPlan', { selectedIndices, requestId: review.requestId, availableMinutes: review.result.availableMinutes, recommendation: review.result.recommendation, ...(review.mode === 'daily' ? { daily: review.daily } : {}) })
      navigate(review.mode === 'daily' && explicitTarget ? `/plans?date=${review.daily.planDate}` : `/plans/${id}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the selected activities. Please retry.') }
    finally { accepting.current = false; setBusy(null) }
  }
  const extending = dailyMode && !!daily.plan && !daily.closed
  const inputHeading = dailyMode ? extending ? targetDate === day.planDate ? "Add to today's plan" : `Add to the plan for ${displayDate(targetDate, true)}` : targetDate === day.planDate ? "Build today's plan" : targetValid ? `Plan ${displayDate(targetDate)}` : 'Plan a day' : 'Help me plan'
  const selectedCount = selectedIndices.length
  const activityLabel = `${selectedCount} ${selectedCount === 1 ? 'activity' : 'activities'}`
  const acceptanceLabel = review?.mode === 'daily' ? extending ? `Add ${activityLabel}` : `Create plan with ${activityLabel}` : `Use ${activityLabel}`
  return <div className="plans-flow planner-page">
    <Link to="/plans" className="underline">Back to Plans</Link>
    <h1 className={review && !editingInputs ? 'planner-review-page-heading' : 'display-heading'}>{review && !editingInputs ? 'Choose your activities' : inputHeading}</h1>
    {dailyMode && targetValid && <p className="eyebrow">{targetDate === day.planDate ? 'Today · ' : 'Planning for · '}{displayDate(targetDate, true)}</p>}{dailyMode && !targetValid && <p role="alert">Choose a valid date that is today or in the future.</p>}
    {extending && (!review || editingInputs) && <p>You already have {daily.plan!.data.planItemIds.length} {daily.plan!.data.planItemIds.length === 1 ? 'activity' : 'activities'} planned. How much more time do you want to make room for? <Link className="underline" to={`/plans/${daily.plan!.recordId}`}>View plan</Link></p>}
    {dailyMode && daily.conflict && <p role="alert">Multiple daily plans exist for this date. <Link to="/plans">Open Plans to inspect them.</Link></p>}
    {dailyMode && plans.records.length >= 500 && <p role="alert">Too many plans to fully check this date. Planning remains unavailable.</p>}
    {dailyMode && plans.error && <p role="alert">Could not load plans for this date. Reload to retry.</p>}
    {dailyMode && daily.closed && <p role="alert">This date’s plan is explicitly closed and cannot be extended.</p>}
    {(!review || editingInputs) && <p>PrepFlow considers your Prep Areas, unfinished work, recent focus, and relevant interviews. You'll choose what gets added.</p>}
    {areas.status === 'loading' && <p>Loading your Prep Areas…</p>}
    {areas.error && <p role="alert">Could not load Prep Areas. Reload to retry.</p>}
    {areas.status === 'ready' && !hasAreas && <p>Create a Prep Area in <Link to="/prep" className="underline">My Prep</Link> before building a plan. An interview is optional.</p>}
    {review && editingInputs && <Button variant="link" onClick={() => setEditingInputs(false)}>Back to suggestions</Button>}
    {(!review || editingInputs) && hasAreas && (!dailyMode || (targetValid && daily.planningAllowed)) && <form onSubmit={(event) => { event.preventDefault(); void generate() }} className="planner-form">
      <fieldset disabled={busy !== null} className="space-y-3">
        <legend className="text-xl font-semibold">How much time do you have?</legend>
        <div className="duration-options" role="group" aria-label="Available time">{[['30', '30 min'], ['60', '60 min'], ['90', '90 min'], ['120', '2 hours']].map(([value, label]) => <button type="button" key={value} aria-pressed={!customMinutes && minutes === value} onClick={() => { setMinutes(value!); setCustomMinutes(false) }}>{label}</button>)}<button type="button" aria-pressed={customMinutes} onClick={() => setCustomMinutes(true)}>Custom</button></div>
        {customMinutes && <Field label="Available minutes"><Input type="number" min={1} max={1440} step={1} required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></Field>}
        <Field label="Priority or goal (optional)"><Textarea maxLength={2000} value={goal} onChange={(event) => setGoal(event.target.value)} /></Field>
        <PlanBuildButton type="submit" disabled={busy !== null}>Get suggestions</PlanBuildButton>
      </fieldset>
    </form>}
    {busy === 'generation' && <div role="status">Getting suggestions… <Button variant="secondary" onClick={() => controller.current?.abort()}>Cancel</Button></div>}
    {error && <p role="alert">{error}</p>}
    {review && !editingInputs && <><Button variant="link" className="planner-change-inputs" disabled={busy !== null} onClick={() => setEditingInputs(true)}>Change time or priority</Button>{review.daily && <p className="planner-reviewed-date">Reviewed for {displayDate(review.daily.planDate)}</p>}{review.daily && (review.reviewedLocalDate !== day.planDate || review.daily.timeZone !== day.timeZone) && <div role="alert"><p>Your local day or timezone changed. This suggestion has not been rescheduled.</p><Button variant="outline" disabled={busy !== null} onClick={() => setReview({ ...review, reviewedLocalDate: day.planDate, daily: { planDate: explicitTarget ? review.daily!.planDate : day.planDate, timeZone: day.timeZone } })}>Review this suggestion for {displayDate(explicitTarget ? review.daily.planDate : day.planDate)}</Button></div>}{review.daily && review.daily.planDate < day.planDate && <p role="alert">This planning date has passed. Choose today or a future date.</p>}<PlannerSuggestion heading={extending ? targetDate === day.planDate ? "Suggestions for today’s plan" : `Suggestions for ${displayDate(review.daily!.planDate, true)}` : undefined} result={review.result} selectedIndices={selectedIndices} disabled={selectionFrozen || busy !== null} onSelection={(index) => setSelectedIndices((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])} /><div className="planner-review-decision"><div><p className="planner-decision-total">{selectedIndices.reduce((sum, index) => sum + review.result.recommendation.items[index]!.estimatedMinutes, 0)} min selected</p><p className="planner-review-help">Only selected activities will be saved. Focus starts when you choose to begin.</p></div><Button disabled={busy !== null || !focus.ready || !selectedIndices.length} onClick={() => void accept()}>{busy === 'acceptance' ? 'Saving plan…' : acceptanceLabel}</Button></div><PlannerCoverage notices={review.result.coverageNotices} /></>}
  </div>
}
