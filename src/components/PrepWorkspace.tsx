import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutations, useQuery, useUser, type RecordData } from 'deepspace'
import { Button, Input, Textarea } from './ui'
import { runPrepAction } from '../lib/prep-actions'
import type { PrepArea, Interview, PrepSession, SessionOutcome } from '../schemas/prep-schema'

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
const dateTime = (value: string) => new Date(value).toLocaleString()

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-lg border border-border p-5"><h2 className="mb-4 text-xl font-semibold">{title}</h2>{children}</section>
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1 text-sm"><span>{label}</span>{children}</label>
}

export function PrepWorkspace() {
  const { user } = useUser()
  const areas = useQuery<PrepArea>('prep-areas', { orderBy: 'createdAt', orderDir: 'desc' })
  const interviews = useQuery<Interview>('interviews', { orderBy: 'createdAt', orderDir: 'desc' })
  // Do not limit this query: history limits must never hide old active rows.
  const active = useQuery<PrepSession>('prep-sessions', { where: { state: 'active' } })
  const recent = useQuery<PrepSession>('prep-sessions', { where: { state: 'ended' }, orderBy: 'startedAt', orderDir: 'desc', limit: 20 })
  const areaMutations = useMutations<PrepArea>('prep-areas')
  const sessionMutations = useMutations<PrepSession>('prep-sessions')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Bridge acknowledgement -> broadcast without permitting another start.
  const [startedId, setStartedId] = useState<string | null>(null)
  const queries = [areas, interviews, active, recent]
  const loaded = queries.every((query) => query.status === 'ready')
  const queryError = queries.find((query) => query.status === 'error')?.error
  const writable = user?.role === 'member' || user?.role === 'admin'
  const ready = loaded && areaMutations.ready && sessionMutations.ready && writable && !busy
  const awaitingFocus = !!startedId && !active.records.some((record) => record.recordId === startedId) && !recent.records.some((record) => record.recordId === startedId)
  const canStart = ready && active.records.length === 0 && !awaitingFocus

  async function save(work: () => Promise<void>, message: string) {
    if (!ready) return
    setBusy(true); setError(''); setNotice('')
    try { await work(); setNotice(message) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save. Try again.') }
    finally { setBusy(false) }
  }

  async function createArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    if (!name) { setError('Enter a Prep Area name.'); return }
    await save(async () => { await areaMutations.createConfirmed({ name, notes: String(data.get('notes') ?? '').trim() }); form.reset() }, 'Prep Area saved.')
  }
  async function createInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    await save(async () => {
      await runPrepAction('createInterview', {
        company: String(data.get('company') ?? ''), role: String(data.get('role') ?? ''),
        scheduledDate: String(data.get('scheduledDate') ?? ''), stage: String(data.get('stage') ?? ''),
        notes: String(data.get('notes') ?? ''), prepAreaIds: data.getAll('prepAreaIds').map(String),
      })
      form.reset()
    }, 'Interview saved.')
  }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canStart) return
    const form = event.currentTarget
    const data = new FormData(form)
    await save(async () => {
      const recordId = await runPrepAction('startPrepSession', {
        prepAreaId: String(data.get('prepAreaId') ?? ''),
        interviewId: String(data.get('interviewId') ?? '') || undefined,
        intent: String(data.get('intent') ?? ''), notes: String(data.get('notes') ?? ''),
      })
      setStartedId(recordId); form.reset()
    }, 'Focus session started.')
  }
  const areaName = (id: string) => areas.records.find((record) => record.recordId === id)?.data.name ?? 'Unavailable Prep Area'
  const interviewName = (id?: string) => id ? interviews.records.find((record) => record.recordId === id)?.data.company ?? 'Unavailable Interview' : 'General preparation'

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
      <header><h1 className="text-3xl font-semibold">PrepFlow</h1><p className="mt-2 text-muted-foreground">Choose an area, focus on one attempt, and keep the context of your work. Interviews are optional.</p></header>
      {!loaded && !queryError && <p role="status">Loading your workspace…</p>}
      {queryError && <p role="alert" className="text-destructive">Could not load your workspace: {queryError}. Reconnect or reload to try again.</p>}
      {loaded && !writable && <p role="status">Your account has read-only access.</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Section title="Current Focus">
        {active.records.length > 1 && <p role="alert" className="mb-4 text-destructive">You have {active.records.length} active sessions, possibly from simultaneous starts in different tabs. End the extra attempts below. Starting another session is disabled.</p>}
        {active.records.map((record) => <FocusAttempt key={record.recordId} record={record} area={areaName(record.data.prepAreaId)} interview={interviewName(record.data.interviewId)} disabled={!ready} onStuck={(notes) => save(async () => { await sessionMutations.putConfirmed(record.recordId, { encounteredStuck: true, notes }) }, 'Difficulty recorded. Your session is still active.')} onEnd={(outcome, notes) => save(async () => {
          await sessionMutations.putConfirmed(record.recordId, { state: 'ended', outcome, endedAt: new Date(Math.max(Date.now(), Date.parse(record.data.startedAt))).toISOString(), notes })
          if (startedId === record.recordId) setStartedId(null)
        }, `Session ${outcome}.`)} />)}
        {awaitingFocus && <p role="status">Your session was accepted. Waiting for the live workspace to update…</p>}
        {loaded && active.records.length === 0 && !awaitingFocus && <>
          <p className="mb-4 text-sm text-muted-foreground">No current session. Start one continuous focus attempt below.</p>
          {areas.records.length === 0 ? <p>Create your first Prep Area to begin. You do not need an interview.</p> : <form onSubmit={start} className="space-y-3">
            <fieldset disabled={!canStart} className="space-y-3">
              <Field label="Prep Area"><select name="prepAreaId" className={selectClass} required defaultValue=""><option value="" disabled>Choose an area</option>{areas.records.map((area) => <option key={area.recordId} value={area.recordId}>{area.data.name}</option>)}</select></Field>
              <Field label="Interview (optional)"><select name="interviewId" className={selectClass}><option value="">General preparation</option>{interviews.records.map((interview) => <option key={interview.recordId} value={interview.recordId}>{interview.data.company}{interview.data.stage ? ` — ${interview.data.stage}` : ''}</option>)}</select></Field>
              <Field label="What do you intend to work on?"><Input name="intent" required maxLength={10000} placeholder="For example: practice SQL window functions" /></Field>
              <Field label="Starting notes (optional)"><Textarea name="notes" maxLength={10000} /></Field>
              <Button type="submit">Start focus session</Button>
            </fieldset>
          </form>}
        </>}
      </Section>
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Prep Areas">
          {loaded && !areas.records.length && <p className="mb-4 text-sm text-muted-foreground">Add anything you want to practice or improve. You choose the names.</p>}
          <ul className="mb-5 space-y-3">{areas.records.map((area) => <li key={area.recordId}><h3 className="font-medium break-words">{area.data.name}</h3>{area.data.notes && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{area.data.notes}</p>}</li>)}</ul>
          <form onSubmit={createArea}><fieldset disabled={!ready} className="space-y-3"><Field label="Area name"><Input name="name" required maxLength={200} placeholder="For example: PyTorch" /></Field><Field label="Goals or context (optional)"><Textarea name="notes" maxLength={10000} /></Field><Button type="submit">Create Prep Area</Button></fieldset></form>
        </Section>
        <Section title="Upcoming Interviews">
          {loaded && !interviews.records.length && <p className="mb-4 text-sm text-muted-foreground">No interviews added. General preparation works without them.</p>}
          <ul className="mb-5 space-y-4">{interviews.records.map((interview) => <li key={interview.recordId} className="break-words"><h3 className="font-medium">{interview.data.company}</h3><p className="text-sm">{[interview.data.role, interview.data.stage, interview.data.scheduledDate || 'Date not set'].filter(Boolean).join(' · ')}</p><p className="text-sm text-muted-foreground">{interview.data.prepAreaIds.length ? interview.data.prepAreaIds.map(areaName).join(', ') : 'No Prep Areas linked'}</p>{interview.data.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{interview.data.notes}</p>}</li>)}</ul>
          <form onSubmit={createInterview}><fieldset disabled={!ready} className="space-y-3">
            <Field label="Company"><Input name="company" required maxLength={200} /></Field>
            <Field label="Role (optional)"><Input name="role" maxLength={200} /></Field>
            <Field label="Date (optional)"><Input name="scheduledDate" type="date" /></Field>
            <Field label="Stage or type (optional)"><Input name="stage" maxLength={200} /></Field>
            <fieldset className="space-y-2"><legend className="mb-2 text-sm">Relevant Prep Areas (optional)</legend>{areas.records.length ? areas.records.map((area) => <label key={area.recordId} className="flex items-center gap-2 text-sm"><input type="checkbox" name="prepAreaIds" value={area.recordId} />{area.data.name}</label>) : <p className="text-sm text-muted-foreground">You can create an interview with no linked areas.</p>}</fieldset>
            <Field label="Topics or context (optional)"><Textarea name="notes" maxLength={10000} /></Field>
            <Button type="submit">Create Interview</Button>
          </fieldset></form>
        </Section>
      </div>
      <Section title="Recent Sessions">
        {loaded && !recent.records.length && <p className="text-sm text-muted-foreground">Your ended attempts will appear here.</p>}
        <ul className="space-y-4">{recent.records.map((record) => <li key={record.recordId} className="border-b border-border pb-4 last:border-0 last:pb-0"><h3 className="font-medium break-words">{record.data.intent}</h3><p className="text-sm">{areaName(record.data.prepAreaId)} · {interviewName(record.data.interviewId)}</p><p className="text-sm text-muted-foreground">{record.data.outcome} · {dateTime(record.data.startedAt)}{record.data.endedAt ? ` → ${dateTime(record.data.endedAt)}` : ''}{record.data.encounteredStuck ? ' · Encountered difficulty' : ''}</p>{record.data.notes && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{record.data.notes}</p>}</li>)}</ul>
        {recent.records.length === 20 && <p className="mt-3 text-sm text-muted-foreground">Showing the 20 most recent ended sessions.</p>}
      </Section>
    </div>
  )
}

function FocusAttempt({ record, area, interview, disabled, onStuck, onEnd }: {
  record: RecordData<PrepSession>; area: string; interview: string; disabled: boolean
  onStuck: (notes: string) => Promise<void>
  onEnd: (outcome: SessionOutcome, notes: string) => Promise<void>
}) {
  const [notes, setNotes] = useState(record.data.notes ?? '')
  return <article className="mb-4 space-y-3 rounded-md border border-border p-4">
    <h3 className="font-semibold break-words">{record.data.intent}</h3>
    <p className="text-sm">{area} · {interview}</p><p className="text-sm text-muted-foreground">Started {dateTime(record.data.startedAt)}</p>
    {record.data.encounteredStuck ? <p className="text-sm">Difficulty reported during this attempt. You can keep working.</p> : null}
    <Field label="Session notes — progress, difficulty, or where you stopped"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={10000} disabled={disabled} /></Field>
    <p className="text-xs text-muted-foreground">Notes save when you report difficulty or end the session.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={disabled || !!record.data.encounteredStuck} onClick={() => void onStuck(notes)}>Report difficulty (keep working)</Button>
      <Button disabled={disabled} onClick={() => void onEnd('completed', notes)}>Complete</Button>
      <Button variant="secondary" disabled={disabled} onClick={() => void onEnd('stopped', notes)}>Stop</Button>
      <Button variant="secondary" disabled={disabled} onClick={() => void onEnd('switched', notes)}>End to switch</Button>
    </div>
    <p className="text-xs text-muted-foreground">Ending to switch records this attempt. Choose your next area yourself.</p>
  </article>
}
