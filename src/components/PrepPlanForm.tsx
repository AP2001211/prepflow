import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getAuthToken, useMutations, useQuery } from 'deepspace'
import type { Interview, PrepArea, PrepPlan } from '../schemas/prep-schema'
import { normalizedAreaName, prepStrategyRequestSchema, validatePrepStrategy } from '../ai/prep-strategy-contract'
import { confirmSuggestedArea } from '../lib/suggested-prep-area'
import { useSave } from '../lib/use-save'
import { runPrepAction } from '../lib/prep-actions'
import { Field, selectClass } from './prep-ui'
import { Button, Input, Textarea } from './ui'

type Anchor = { interviewId: string; goal?: never } | { goal: string; interviewId?: never }

export function PrepPlanForm({ plan, planId, onSaved, onCancel }: { plan?: PrepPlan; planId?: string; onSaved?: () => void; onCancel?: () => void }) {
  const areas = useQuery<PrepArea>('prep-areas')
  const areaMutations = useMutations<PrepArea>('prep-areas')
  const [createdAreas, setCreatedAreas] = useState<Array<{ recordId: string; data: PrepArea }>>([])
  const inventory = [...areas.records, ...createdAreas.filter((area) => !areas.records.some((row) => row.recordId === area.recordId))]
  const [suggestions, setSuggestions] = useState<Array<{ name: string }>>([])
  const [adding, setAdding] = useState<string | null>(null)
  const [areaName, setAreaName] = useState('')
  const [areaNotes, setAreaNotes] = useState('')
  const areaFeedback = useSave(areaMutations.ready && areas.status === 'ready' && !areas.error)
  const interviews = useQuery<Interview>('interviews')
  const plans = useQuery<PrepPlan>('prep-plans')
  const [anchor, setAnchor] = useState(plan?.interviewId ? 'interview' : 'goal')
  const [interviewId, setInterviewId] = useState(plan?.interviewId ?? '')
  const [goal, setGoal] = useState(plan?.goal ?? '')
  const [title, setTitle] = useState(plan?.title ?? '')
  const [context, setContext] = useState(plan?.context ?? '')
  const [selectedAreas, setSelectedAreas] = useState<string[]>(plan?.prepAreaIds ?? [])
  const [reviewAnchor, setReviewAnchor] = useState<Anchor | null>(null)
  const [manual, setManual] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const generationLock = useRef(false)
  const [frozen, setFrozen] = useState(false)
  const submission = useRef<Record<string, unknown> | null>(null)
  const navigate = useNavigate()
  const ready = [areas, interviews, plans].every((query) => query.status === 'ready' && !query.error)
  const feedback = useSave(ready)
  const currentAnchor = reviewAnchor ?? (anchor === 'interview' ? { interviewId } : { goal: goal.trim() })
  const existing = !plan && currentAnchor.interviewId ? plans.records.find((row) => row.data.interviewId === currentAnchor.interviewId) : undefined
  const editing = !!plan || manual || !!reviewAnchor
  const busy = generating || feedback.busy || areaFeedback.busy

  async function generate() {
    if (!ready || busy || frozen || existing || generationLock.current) return
    const input = prepStrategyRequestSchema.safeParse(currentAnchor)
    if (!input.success) { setGenerationError('Choose an interview or enter a preparation goal.'); return }
    generationLock.current = true; setGenerating(true); setGenerationError('')
    try {
      const token = await getAuthToken()
      if (!token) throw new Error('Please sign in again.')
      const response = await fetch('/api/ai/prep-strategy', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input.data),
      })
      const result = await response.json() as { proposal?: unknown; error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not generate a prep plan. Retry or continue manually.')
      const proposal = validatePrepStrategy(result.proposal, areas.records.map((row) => row.recordId))
      setTitle(proposal.title); setContext(proposal.context); setSelectedAreas(proposal.existingPrepAreaIds)
      setSuggestions(proposal.suggestedPrepAreas); setAdding(null)
      setReviewAnchor(input.data as Anchor); setManual(false)
    } catch (cause) {
      setGenerationError(cause instanceof Error ? cause.message : 'Could not generate a prep plan. Retry or continue manually.')
    } finally { generationLock.current = false; setGenerating(false) }
  }

  const matchingArea = inventory.find((area) => normalizedAreaName(area.data.name) === normalizedAreaName(areaName))
  async function addArea() {
    if (busy || frozen) return
    await areaFeedback.save(async () => {
      const { area, created } = await confirmSuggestedArea(areaName, areaNotes, inventory, areaMutations.createConfirmed)
      if (created) setCreatedAreas((rows) => [...rows, area])
      setSelectedAreas((ids) => [...new Set([...ids, area.recordId])])
      setSuggestions((rows) => rows.filter((row) => row.name !== adding))
      setAdding(null)
    }, 'Prep Area selected. Save your prep plan when you’re ready.')
  }

  return <form className="prep-plan-form" onSubmit={(event) => {
    event.preventDefault()
    if (busy || existing) return
    if (!editing) { void generate(); return }
    void feedback.save(async () => {
      if (!submission.current) {
        submission.current = { title, context, prepAreaIds: selectedAreas,
          ...(plan ? (plan.interviewId ? {} : { goal }) : currentAnchor),
          ...(planId ? { prepPlanId: planId } : { requestId: crypto.randomUUID() }) }
        setFrozen(true)
      }
      const id = await runPrepAction(planId ? 'updatePrepPlan' : 'createPrepPlan', submission.current)
      submission.current = null; setFrozen(false)
      if (onSaved) onSaved(); else navigate(`/plans/prep/${id}`)
    }, 'Prep plan saved.')
  }}>
    {!ready && <p role={areas.error || interviews.error || plans.error ? 'alert' : 'status'}>{areas.error || interviews.error || plans.error ? 'Could not load preparation context. Reload to retry.' : 'Loading preparation context…'}</p>}
    {feedback.error && <p role="alert">{feedback.error}</p>}
    {generationError && <p role="alert">{generationError}</p>}
    <fieldset disabled={!ready || busy || frozen} className="space-y-5">
      {!plan && !reviewAnchor && <>
        <fieldset className="prep-plan-anchor"><legend>What are you preparing for?</legend><label><input type="radio" name="anchor" checked={anchor === 'interview'} onChange={() => { setAnchor('interview'); setInterviewId(''); setGenerationError('') }} /> An interview</label><label><input type="radio" name="anchor" checked={anchor === 'goal'} onChange={() => { setAnchor('goal'); setGenerationError('') }} /> Another preparation goal</label></fieldset>
        {anchor === 'interview' && <Field label="Interview"><select className={selectClass} required value={interviewId} onChange={(event) => setInterviewId(event.target.value)}><option value="">Choose an interview</option>{interviews.records.map((row) => <option key={row.recordId} value={row.recordId}>{row.data.company}{row.data.role ? ` · ${row.data.role}` : ''}</option>)}</select></Field>}
      </>}
      {anchor === 'goal' && !reviewAnchor && <Field label="Preparation goal"><Input name="goal" required maxLength={500} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="For example: Improve system design interviewing" /></Field>}
      {reviewAnchor && <p className="text-muted-foreground">{reviewAnchor.interviewId ? interviews.records.filter((row) => row.recordId === reviewAnchor.interviewId).map((row) => [row.data.company, row.data.role].filter(Boolean).join(' · ')).join('') : reviewAnchor.goal}</p>}
      {editing && !existing && <section className="prep-plan-review space-y-5" aria-label={reviewAnchor ? 'Review prep plan' : 'Prep plan fields'}>
        {reviewAnchor && <div><h2>Review your prep plan</h2><p className="text-sm text-muted-foreground">Make it yours, then save.</p></div>}
        <Field label="Plan name"><Input name="title" required maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="Preparation focus"><Textarea name="context" required maxLength={2000} rows={5} value={context} onChange={(event) => setContext(event.target.value)} placeholder="What matters for this preparation?" /></Field>
        <fieldset className="prep-plan-area-options"><legend>Relevant prep areas</legend>{inventory.map((area) => <label key={area.recordId}><input type="checkbox" name="prepAreaIds" value={area.recordId} checked={selectedAreas.includes(area.recordId)} onChange={(event) => setSelectedAreas((ids) => event.target.checked ? [...ids, area.recordId] : ids.filter((id) => id !== area.recordId))} />{area.data.name}</label>)}{!inventory.length && <p className="text-sm text-muted-foreground">No prep areas yet. You can add them in My Prep later.</p>}</fieldset>
        {reviewAnchor && suggestions.length > 0 && <section className="space-y-3" aria-label="Suggested Prep Areas"><h3 className="font-medium">Suggested Prep Areas</h3>
          {suggestions.map((suggestion) => <div key={suggestion.name} className="flex flex-wrap items-center gap-3"><span>{suggestion.name}</span><Button type="button" variant="secondary" disabled={!areaMutations.ready} onClick={() => { setAdding(suggestion.name); setAreaName(suggestion.name); setAreaNotes('') }}>Add Prep Area</Button></div>)}
          {adding !== null && <div className="space-y-3" role="group" aria-label="Create suggested Prep Area" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); void addArea() } }}>
            <Field label="Area name"><Input maxLength={200} value={areaName} onChange={(event) => setAreaName(event.target.value)} /></Field>
            <Field label="Goals or context (optional)"><Textarea maxLength={10000} value={areaNotes} onChange={(event) => setAreaNotes(event.target.value)} /></Field>
            {matchingArea && <p className="text-sm text-muted-foreground">An area with this name already exists. You can select it instead.</p>}
            <Button type="button" disabled={!areaMutations.ready || !areaName.trim()} onClick={() => { void addArea() }}>{matchingArea ? 'Use existing area' : 'Create Prep Area'}</Button>
            <Button type="button" variant="link" onClick={() => setAdding(null)}>Cancel</Button>
          </div>}
          {areaFeedback.error && <p role="alert">{areaFeedback.error}</p>}
        </section>}
        {reviewAnchor && areaFeedback.notice && <p role="status">{areaFeedback.notice}</p>}
      </section>}
    </fieldset>
    {existing ? <p>This interview already has a prep plan. <Link className="underline" to={`/plans/prep/${existing.recordId}`}>Open existing prep plan</Link></p> : <div className="prep-plan-form-actions">
      {editing ? <Button type="submit" disabled={!ready || busy}>{feedback.busy ? 'Saving…' : frozen ? 'Retry save' : plan ? 'Save changes' : 'Save prep plan'}</Button> : <Button type="submit" disabled={!ready || busy}>{generating ? 'Building…' : 'Build my prep plan'}</Button>}
      {!plan && <>
        {manual && !reviewAnchor && <Button type="button" variant="secondary" disabled={!ready || busy || frozen} onClick={() => { void generate() }}>{generating ? 'Building…' : 'Build with AI'}</Button>}
        {reviewAnchor && <Button type="button" variant="secondary" disabled={!ready || busy || frozen} onClick={() => { void generate() }}>{generating ? 'Building…' : 'Regenerate strategy'}</Button>}
        {!reviewAnchor && !manual && <Button type="button" variant="link" disabled={!ready || busy || frozen} onClick={() => setManual(true)}>Continue manually</Button>}
        {reviewAnchor && <Button type="button" variant="link" disabled={busy || frozen} onClick={() => { setReviewAnchor(null); setManual(false); setGenerationError('') }}>Change interview or goal</Button>}
      </>}
      {onCancel && <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>}
    </div>}
    {frozen && feedback.error && <Button type="button" variant="link" onClick={() => { submission.current = null; setFrozen(false) }}>Edit this submission</Button>}
  </form>
}
