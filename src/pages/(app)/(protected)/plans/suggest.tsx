import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { PrepArea } from '../../../../schemas/prep-schema'
import type { PlannerResponse } from '../../../../ai/planner-contract'
import { requestPrepPlan } from '../../../../lib/planner'
import { runPrepAction } from '../../../../lib/prep-actions'
import { useFocus } from '../../../../components/FocusController'
import { PlannerSuggestion } from '../../../../components/PlannerSuggestion'
import { Field } from '../../../../components/prep-ui'
import { Button, Input, Textarea } from '../../../../components/ui'

export default function SuggestPlanPage() {
  const areas = useQuery<PrepArea>('prep-areas')
  const focus = useFocus()
  const navigate = useNavigate()
  const [minutes, setMinutes] = useState('30')
  const [goal, setGoal] = useState('')
  const [review, setReview] = useState<{ result: PlannerResponse; requestId: string } | null>(null)
  const [busy, setBusy] = useState<'generation' | 'acceptance' | null>(null)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const accepting = useRef(false)
  useEffect(() => () => controller.current?.abort(), [])
  const hasAreas = areas.status === 'ready' && areas.records.length > 0
  async function generate() {
    if (controller.current || accepting.current || !hasAreas) return
    const abort = new AbortController(); controller.current = abort
    setBusy('generation'); setError(''); setReview(null)
    try {
      const result = await requestPrepPlan({ availableMinutes: Number(minutes), ...(goal.trim() ? { goal: goal.trim() } : {}) }, abort.signal)
      if (!abort.signal.aborted) setReview({ result: structuredClone(result), requestId: crypto.randomUUID() })
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Planning failed. Please retry.') }
    finally { if (controller.current === abort) { controller.current = null; setBusy(null) } }
  }
  async function accept() {
    if (!review || accepting.current || controller.current) return
    accepting.current = true; setBusy('acceptance'); setError('')
    try {
      const id = await runPrepAction('acceptPrepPlan', { requestId: review.requestId, availableMinutes: review.result.availableMinutes, recommendation: review.result.recommendation })
      navigate(`/plans/${id}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the plan. Retry Use this plan.') }
    finally { accepting.current = false; setBusy(null) }
  }
  return <div className="mx-auto max-w-3xl space-y-5 px-5 py-8">
    <Link to="/plans" className="underline">Back to Plans</Link>
    <h1 className="text-3xl font-semibold">Help me plan</h1>
    <p>Build a suggestion from your preparation. Review it before saving a new Plan.</p>
    {areas.status === 'loading' && <p>Loading your Prep Areas…</p>}
    {areas.error && <p role="alert">Could not load Prep Areas. Reload to retry.</p>}
    {areas.status === 'ready' && !hasAreas && <p>Create a Prep Area in <Link to="/prep" className="underline">My Prep</Link> before building a plan. An interview is optional.</p>}
    {hasAreas && <form onSubmit={(event) => { event.preventDefault(); void generate() }} className="space-y-3">
      <fieldset disabled={busy !== null} className="space-y-3">
        <Field label="Available minutes"><Input type="number" min={1} max={1440} step={1} required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></Field>
        <Field label="Goal (optional)"><Textarea maxLength={2000} value={goal} onChange={(event) => setGoal(event.target.value)} /></Field>
        <Button type="submit">Build my plan</Button>
      </fieldset>
    </form>}
    {busy === 'generation' && <div role="status">Building your plan… <Button variant="secondary" onClick={() => controller.current?.abort()}>Cancel</Button></div>}
    {error && <p role="alert">{error}</p>}
    {review && <><PlannerSuggestion result={review.result} /><p className="text-sm">Use this plan saves the reviewed work in order. It will not start focus.</p><Button disabled={busy !== null || !focus.ready} onClick={() => void accept()}>{busy === 'acceptance' ? 'Saving plan…' : 'Use this plan'}</Button></>}
  </div>
}
