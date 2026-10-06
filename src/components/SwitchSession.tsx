import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStatus, useQuery, type RecordData } from 'deepspace'
import type { Plan, PrepArea, PrepSession, SwitchReason } from '../schemas/prep-schema'
import { useFocus } from './FocusController'
import { switchDestinations, switchFocusDuration } from '../lib/switch-destinations'
import { browserDay, dailyPlanState } from '../lib/plan-date'
import { runPrepAction } from '../lib/prep-actions'
import { useSave } from '../lib/use-save'
import { Button, Modal, Textarea } from './ui'
import { Field } from './prep-ui'
import { WorkItemForm } from './WorkItemForm'

const contextLabels: Record<SwitchReason, string> = { stuck: 'Where did you get stuck?', break: 'Where are you leaving off?', higher_priority: 'Anything future-you should remember?', switching_gears: 'Want to leave yourself a breadcrumb?' }
const reasons: [SwitchReason, string][] = [['stuck', "I'm stuck"], ['break', 'Need a break'], ['higher_priority', "Something's more important"], ['switching_gears', 'Just switching']]
export function SwitchSession({ sessionId }: { sessionId: string }) {
  const { userId } = useAuthStatus()
  // An ID-scoped SDK subscription makes refresh independent of controller drafts
  // and of the bounded recent-session list. RBAC still applies to this query.
  const query = useQuery<PrepSession>('prep-sessions', { where: { recordId: sessionId }, limit: 1 })
  const source = query.records.find((row) => row.recordId === sessionId && row.createdBy === userId)
  return <div className="switch-workspace plans-flow">
    {query.status === 'loading' ? <p role="status">Loading your session…</p> : query.status === 'error' || !source || source.data.state !== 'ended' || source.data.outcome !== 'switched'
      ? <><h1>This switch session is unavailable.</h1><Link className="quiet-link" to="/home">Back Home</Link></>
      : <SwitchContent key={source.recordId} source={source} />}
  </div>
}
function SwitchContent({ source }: { source: RecordData<PrepSession> }) {
  const focus = useFocus()
  const navigate = useNavigate()
  const day = browserDay().planDate
  const plans = useQuery<Plan>('plans', { where: { planDate: day }, limit: 500 })
  const areas = useQuery<PrepArea>('prep-areas')
  const [leftOff, setLeftOff] = useState(source.data.leftOff ?? '')
  const [nextStep, setNextStep] = useState(source.data.nextStep ?? '')
  const [switchReason, setReason] = useState<SwitchReason | undefined>(source.data.switchReason)
  const saved = useRef({ leftOff, nextStep, switchReason })
  const [stage, setStage] = useState<'reason' | 'context' | 'next'>(source.data.switchReason || source.data.leftOff || source.data.nextStep ? 'next' : 'reason')
  const stageHeading = useRef<HTMLHeadingElement>(null)
  const previousStage = useRef(stage)
  useEffect(() => {
    if (previousStage.current !== stage) stageHeading.current?.focus()
    previousStage.current = stage
  }, [stage])
  const [creating, setCreating] = useState(false)
  const feedback = useSave(focus.ready)
  async function persist() {
    if (saved.current.leftOff === leftOff && saved.current.nextStep === nextStep && saved.current.switchReason === switchReason) return
    await runPrepAction('saveResumeContext', { sessionId: source.recordId, leftOff, nextStep, ...(switchReason ? { switchReason } : {}) })
    saved.current = { leftOff, nextStep, switchReason }
  }
  function choose(itemId: string, planId?: string) {
    void feedback.save(async () => {
      await persist()
      if (!await focus.start(itemId, planId)) throw new Error('Focus could not start. Please retry or return to the active session.')
    }, '')
  }
  const state = dailyPlanState(plans.records, focus.items.records, day, plans.status === 'ready' && focus.loaded)
  const { resume, planned } = switchDestinations(source.data.planItemId, focus.items.records, focus.sessions.records, state.currentPlan)
  const disabled = !focus.canStart || feedback.busy
  return <>
    <p className="switch-eyebrow">Switching from</p><h1>{source.data.intent}</h1>
    <p className="text-muted-foreground">{areas.records.find((area) => area.recordId === source.data.prepAreaId)?.data.name ?? 'Prep Area'} · {switchFocusDuration(source.data)}</p>
    {focus.active.length || focus.awaitingFocus ? <section className="switch-section"><p>You already have work in focus.</p><Link className="quiet-link" to="/focus">Return to Focus</Link></section> : <>
      {feedback.error && <p role="alert" className="switch-error">{feedback.error}</p>}
      {stage === 'reason' ? <section className="switch-section switch-card" aria-label="Switch reason">
        <h2 ref={stageHeading} tabIndex={-1}>Before you move on…</h2>
        <p>What pulled you away?</p>
        <div className="switch-reasons">{reasons.map(([value, label]) => <Button key={value} variant="secondary" disabled={disabled} aria-pressed={switchReason === value} onClick={() => { setReason(value); setStage('context') }}>{label}</Button>)}</div>
        <button className="quiet-link switch-text-action" disabled={disabled} onClick={() => setStage('next')}>Skip → choose what's next</button>
      </section> : <div className="switch-summary"><p>{switchReason ? <>✓ Switching because: {reasons.find(([value]) => value === switchReason)?.[1]}</> : 'Switch context is optional.'}</p><button className="quiet-link switch-text-action" disabled={disabled} onClick={() => setStage('reason')}>Change reason</button></div>}
      {stage === 'context' && <section className="switch-section switch-card" aria-label="Switch context">
        <h2 ref={stageHeading} tabIndex={-1}>Make it easy to come back.</h2>
        <fieldset disabled={disabled} className="switch-context-fields">
          <Field label={`${switchReason ? contextLabels[switchReason] : 'Where did you leave off?'} (optional)`}><Textarea rows={2} maxLength={10000} value={leftOff} onChange={(event) => setLeftOff(event.target.value)} /></Field>
          <Field label="Next thing to try (optional)"><Textarea rows={2} maxLength={10000} value={nextStep} onChange={(event) => setNextStep(event.target.value)} /></Field>
          <Button onClick={() => setStage('next')}>Choose what's next</Button>
        </fieldset>
      </section>}
      {stage === 'next' && <>
        <div className="switch-summary"><div>{leftOff && <p className="line-clamp-1">Left off: {leftOff}</p>}{nextStep && <p className="line-clamp-1">Next: {nextStep}</p>}</div><button className="quiet-link switch-text-action" disabled={disabled} onClick={() => setStage('context')}>{leftOff || nextStep ? 'Edit context' : 'Add context'}</button></div>
      <section className="switch-section switch-card" aria-label="Next work"><h2 ref={stageHeading} tabIndex={-1}>Okay. What's next?</h2>
        {!focus.loaded && <p role="status">Loading available work…</p>}
        {!!resume.length && <><h3>Pick Back Up</h3><ul className="switch-work-list">{resume.map(({ item, interval }) => <li key={item.recordId}><div><strong>{item.data.intent}</strong><p className="text-sm text-muted-foreground">{areas.records.find((area) => area.recordId === item.data.prepAreaId)?.data.name ?? 'Prep Area'}</p>{interval.data.leftOff && <p className="line-clamp-2 text-sm text-muted-foreground">Left off: {interval.data.leftOff}</p>}{interval.data.nextStep && <p className="line-clamp-2 text-sm text-muted-foreground">Next: {interval.data.nextStep}</p>}</div><Button variant="secondary" disabled={disabled} onClick={() => choose(item.recordId)}>Resume</Button></li>)}</ul></>}
        {state.conflict && <p role="alert">Multiple incomplete plans exist today. Open Plans to review them.</p>}
        {!!planned.length && <><h3>Today's Plan</h3><ul className="switch-work-list">{planned.map((item) => <li key={item.recordId}><strong>{item.data.intent}</strong><Button variant="secondary" disabled={disabled} onClick={() => choose(item.recordId, state.currentPlan!.recordId)}>Start</Button></li>)}</ul></>}
        <Button variant="secondary" disabled={disabled} onClick={() => void feedback.save(async () => { await persist(); setCreating(true) }, '')}>Start something else</Button>
      </section>
      </>}
      <Button variant="secondary" className="switch-done" disabled={!focus.ready || feedback.busy} onClick={() => void feedback.save(async () => { await persist(); navigate('/home') }, '')}>I'm done for now</Button>
    </>}
    <Modal open={creating} onClose={() => setCreating(false)}><Modal.Header><Modal.Title>Start something else</Modal.Title></Modal.Header><WorkItemForm startNow onSaved={() => setCreating(false)} /></Modal>
  </>
}
