import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { AuthGate, useAuthStatus, useMutations, useQuery, useUser } from 'deepspace'
import type { PrepSession, PlanItem, SessionOutcome } from '../schemas/prep-schema'
import { runPrepAction } from '../lib/prep-actions'
import { useSave } from '../lib/use-save'
import { ResumeContextDialog } from './ResumeContextDialog'

type Draft = { notes: string; stop?: { outcome: SessionOutcome; endedAt: string } }
type ContextDraft = { sessionId: string; endedAt?: string; leftOff: string; nextStep: string; outcome?: SessionOutcome }
function useController() {
  // These are SDK subscriptions, never copied into a second record store.
  const sessions = useQuery<PrepSession>('prep-sessions', { orderBy: 'startedAt', orderDir: 'desc' })
  const items = useQuery<PlanItem>('plan-items', { orderBy: 'createdAt', orderDir: 'desc' })
  const mutations = useMutations<PrepSession>('prep-sessions')
  const { user } = useUser()
  const loaded = sessions.status === 'ready' && items.status === 'ready'
  const writable = user?.role === 'member' || user?.role === 'admin'
  const feedback = useSave(loaded && mutations.ready && writable)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const fixedStops = useRef<Record<string, NonNullable<Draft['stop']>>>({})
  const [context, setContext] = useState<ContextDraft | null>(null)
  const [startedId, setStartedId] = useState<string | null>(null)
  const [completionRetryId, setCompletionRetryId] = useState<string | null>(null)
  const active = sessions.records.filter((row) => row.data.state === 'active')
  const pending = sessions.records.filter((row) => row.data.state === 'ended' && row.data.outcome === 'completed' &&
    (row.recordId === completionRetryId || items.records.find((item) => item.recordId === row.data.planItemId)?.data.status !== 'completed'))
  const pendingIds = new Set(pending.map((row) => row.data.planItemId))
  const awaitingFocus = !!startedId && !sessions.records.some((row) => row.recordId === startedId)
  const ready = loaded && mutations.ready && writable && !feedback.busy
  function draft(id: string, notes = '') { return drafts[id] ?? { notes } }
  function setNotes(id: string, notes: string) { setDrafts((old) => ({ ...old, [id]: { ...old[id], notes } })) }
  async function start(planItemId: string, planId?: string, notes?: string) {
    if (active.length || awaitingFocus || pendingIds.has(planItemId)) return false
    return feedback.save(async () => { setStartedId(await runPrepAction('startPrepSession', { planItemId, planId, notes })) }, 'Focus session started.')
  }
  async function end(sessionId: string, outcome: SessionOutcome) {
    const row = sessions.records.find((record) => record.recordId === sessionId)
    if (!row || !ready) return false
    const current = draft(sessionId, row.data.notes)
    // Synchronous ref prevents even same-tick retries from changing this time.
    const stop = fixedStops.current[sessionId] ?? { outcome, endedAt: new Date(Math.max(Date.now(), Date.parse(row.data.startedAt))).toISOString() }
    fixedStops.current[sessionId] = stop
    setDrafts((old) => ({ ...old, [sessionId]: { ...current, stop } }))
    return feedback.save(async () => {
      try { await runPrepAction('endPrepSession', { sessionId, ...stop, notes: current.notes }) }
      catch (cause) { if (stop.outcome === 'completed') setCompletionRetryId(sessionId); throw cause }
      if (stop.outcome === 'completed') setCompletionRetryId(null)
      else setContext({ sessionId, endedAt: stop.endedAt, outcome: stop.outcome, leftOff: '', nextStep: '' })
    }, stop.outcome === 'completed' ? 'Work completed.' : 'Focus stopped. Work remains open.')
  }
  return { sessions, items, active, pending, pendingIds, loaded, ready, canStart: ready && !active.length && !awaitingFocus,
    awaitingFocus, draft, setNotes, start, end, context, setContext, completionRetryId, setCompletionRetryId, ...feedback }
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
  return <FocusContext.Provider value={value}>
    <div className="mx-auto max-w-5xl space-y-3 px-5 pt-3">
      {value.error && <p role="alert" className="text-destructive">{value.error}</p>}
      {value.notice && <p role="status">{value.notice}</p>}
    </div>
    {children}
    <ResumeContextDialog />
  </FocusContext.Provider>
}
