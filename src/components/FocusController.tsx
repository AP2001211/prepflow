import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthGate, useAuthStatus, useMutations, useQuery, useUser } from 'deepspace'
import type { PrepSession, PlanItem, SessionOutcome } from '../schemas/prep-schema'
import { runPrepAction } from '../lib/prep-actions'
import { useSave } from '../lib/use-save'
import { NotesAutosave } from '../lib/notes-autosave'
import { ResumeContextDialog } from './ResumeContextDialog'

export type SessionCompletion = { sessionId: string; title: string; startedAt: string; endedAt: string }

type Draft = { notes: string; stop?: { outcome: SessionOutcome; endedAt: string } }
type ContextDraft = { pendingStop?: boolean; sessionId: string; endedAt?: string; leftOff: string; nextStep: string; outcome?: SessionOutcome }
function useController() {
  const navigate = useNavigate()
  // These are SDK subscriptions, never copied into a second record store.
  const sessions = useQuery<PrepSession>('prep-sessions', { orderBy: 'startedAt', orderDir: 'desc' })
  const items = useQuery<PlanItem>('plan-items', { orderBy: 'createdAt', orderDir: 'desc' })
  const mutations = useMutations<PrepSession>('prep-sessions')
  const { user } = useUser()
  const loaded = sessions.status === 'ready' && items.status === 'ready'
  const writable = user?.role === 'member' || user?.role === 'admin'
  const feedback = useSave(loaded && mutations.ready && writable)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [notesError, setNotesError] = useState('')
  const autosaves = useRef(new Map<string, NotesAutosave>())
  useEffect(() => {
    const queues = autosaves.current
    const flush = () => { for (const queue of queues.values()) void queue.flush().catch(() => {}) }
    const hidden = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', hidden)
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', flush); window.removeEventListener('online', flush); document.removeEventListener('visibilitychange', hidden); for (const queue of queues.values()) queue.dispose(); queues.clear() }
  }, [])
  const fixedStops = useRef<Record<string, NonNullable<Draft['stop']>>>({})
  const [context, setContext] = useState<ContextDraft | null>(null)
  const [startedId, setStartedId] = useState<string | null>(null)
  const [completion, setCompletion] = useState<SessionCompletion | null>(null)
  const [completionRetryId, setCompletionRetryId] = useState<string | null>(null)
  const active = sessions.records.filter((row) => row.data.state === 'active')
  const pending = sessions.records.filter((row) => row.data.state === 'ended' && row.data.outcome === 'completed' &&
    (row.recordId === completionRetryId || items.records.find((item) => item.recordId === row.data.planItemId)?.data.status !== 'completed'))
  const pendingIds = new Set(pending.map((row) => row.data.planItemId))
  const awaitingFocus = !!startedId && !sessions.records.some((row) => row.recordId === startedId)
  const ready = loaded && mutations.ready && writable && !feedback.busy
  useEffect(() => { if (ready) for (const queue of autosaves.current.values()) void queue.flush().catch(() => {}) }, [ready])
  function draft(id: string, notes = '') { return drafts[id] ?? { notes } }
  function setNotes(id: string, notes: string) {
    if (!ready || fixedStops.current[id] || !active.some((row) => row.recordId === id)) return
    setDrafts((old) => ({ ...old, [id]: { ...old[id], notes } }))
    if (!autosaves.current.has(id)) autosaves.current.set(id, new NotesAutosave(async (value) => { await runPrepAction('saveSessionNotes', { sessionId: id, notes: value }) }, setNotesError))
    autosaves.current.get(id)!.schedule(notes)
  }
  // Focus success is acknowledged by its contextual, record-driven UI.
  // Keep shared error/locking behavior, without retaining route-global notices.
  function save(work: () => Promise<void>) { return feedback.save(work, '') }
  async function stuck(sessionId: string, notes: string) {
    return save(async () => {
      await autosaves.current.get(sessionId)?.settle()
      await runPrepAction('reportStuck', { sessionId, notes })
      setNotesError('')
    })
  }
  async function start(planItemId: string, planId?: string, notes?: string) {
    if (active.length || awaitingFocus || pendingIds.has(planItemId)) return false
    const accepted = await save(async () => { setStartedId(await runPrepAction('startPrepSession', { planItemId, planId, notes })); setCompletion(null) })
    if (accepted) navigate('/focus')
    return accepted
  }
  function acknowledgeCompletion(value: SessionCompletion) {
    setCompletionRetryId(null)
    setCompletion(value)
    navigate('/home', { replace: true })
  }
  async function end(sessionId: string, outcome: SessionOutcome, confirmation?: { leftOff?: string; nextStep?: string }) {
    const row = sessions.records.find((record) => record.recordId === sessionId)
    if (!row || !ready) return false
    if (outcome === 'stopped' && confirmation === undefined) {
      setContext({ sessionId, outcome, pendingStop: true, leftOff: '', nextStep: '' })
      return true
    }
    const current = draft(sessionId, row.data.notes)
    // Synchronous ref prevents even same-tick retries from changing this time.
    const stop = fixedStops.current[sessionId] ?? { outcome, endedAt: new Date(Math.max(Date.now(), Date.parse(row.data.startedAt))).toISOString() }
    if (outcome !== 'stopped') {
      fixedStops.current[sessionId] = stop
      setDrafts((old) => ({ ...old, [sessionId]: { ...current, stop } }))
    }
    return save(async () => {
      await autosaves.current.get(sessionId)?.settle()
      try { await runPrepAction('endPrepSession', { sessionId, ...stop, notes: current.notes, ...confirmation }) }
      catch (cause) {
        if (stop.outcome === 'completed') setCompletionRetryId(sessionId)
        if (stop.outcome === 'stopped') autosaves.current.get(sessionId)?.schedule(current.notes)
        throw cause
      }
      setNotesError('')
      if (stop.outcome === 'completed') {
        acknowledgeCompletion({ sessionId, title: row.data.intent, startedAt: row.data.startedAt, endedAt: stop.endedAt })
      }
      else if (stop.outcome === 'stopped') setContext(null)
      else setContext({ sessionId, endedAt: stop.endedAt, outcome: stop.outcome, leftOff: '', nextStep: '' })
    })
  }
  return { sessions, items, active, pending, pendingIds, loaded, ready, canStart: ready && !active.length && !awaitingFocus,
    completion, setCompletion, acknowledgeCompletion, awaitingFocus, draft, setNotes, notesError, stuck, start, end, context, setContext, completionRetryId, setCompletionRetryId, busy: feedback.busy, error: feedback.error, save }
}
const FocusContext = createContext<ReturnType<typeof useController> | null>(null)
export function useFocus() {
  const value = useContext(FocusContext)
  if (!value) throw new Error('Focus controls require the authenticated workspace.')
  return value
}
export function FocusBoundary({ children }: { children: ReactNode }) {
  const { userId } = useAuthStatus()
  return <AuthGate fallback={children}><FocusProvider key={userId}>{children}</FocusProvider></AuthGate>
}
function FocusProvider({ children }: { children: ReactNode }) {
  const value = useController()
  const { pathname } = useLocation()
  const { completion, setCompletion } = value
  const completionShownOnHome = useRef<string | null>(null)
  useEffect(() => {
    if (!completion) { completionShownOnHome.current = null; return }
    // Navigation can resolve after the acknowledged state renders in Focus.
    // Only dismiss on departure once Home has actually received this card.
    if (pathname !== '/home') {
      if (completionShownOnHome.current === completion.sessionId) setCompletion(null)
      return
    }
    completionShownOnHome.current = completion.sessionId
  }, [pathname, completion, setCompletion])
  return <FocusContext.Provider value={value}>
    <div className="mx-auto max-w-5xl space-y-3 px-5 pt-3">
      {value.notesError && <p role="alert" className="text-destructive">{value.notesError}</p>}
      {value.error && <p role="alert" className="text-destructive">{value.error}</p>}
    </div>
    {children}
    <ResumeContextDialog />
  </FocusContext.Provider>
}
