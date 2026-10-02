import type { RecordData } from 'deepspace'
import type { PrepArea, Interview, Plan, PlanItem, PrepSession } from '../schemas/prep-schema'
import { intervalFocusMs } from '../lib/focus'
import type { Recommendation, WorkDisplay } from './planner-contract'

export type ToolExecutor = (name: string, params: Record<string, unknown>) => Promise<unknown>
type Result<T> = { success: boolean; data?: { records?: RecordData<T>[]; record?: RecordData<T> }; truncated?: boolean; error?: string }
export const CONTEXT_LIMITS = { areas: 30, interviews: 30, plans: 20, work: 20, recentIntervals: 30, completed: 10, detailIntervals: 5, previewChars: 300, detailChars: 2000 }
const recentDays = 14

// This executor is the SDK's verified-user, RBAC-on path. Never replace it
// with privileged ActionTools, or expose collection/query parameters to the model.
export function prepReader(executor: ToolExecutor) {
  async function get<T>(collection: string, recordId: string): Promise<RecordData<T>> {
    const result = await executor('records.get', { collection, recordId }) as Result<T>
    if (!result.success || !result.data?.record) throw new Error('A referenced preparation record is unavailable.')
    return result.data.record
  }
  async function page<T>(collection: string, limit: number, where = {}, orderBy = 'createdAt', orderDir = 'desc') {
    const result = await executor('records.query', { collection, where, orderBy, orderDir, limit: limit + 1 }) as Result<T>
    if (!result.success || !result.data?.records) throw new Error('Preparation context could not be read. Please retry.')
    return { records: result.data.records.slice(0, limit), coverage: { returned: Math.min(result.data.records.length, limit), limit, truncated: !!result.truncated || result.data.records.length > limit } }
  }
  async function execution(planItemId: string) {
    const [attempt, ended, completion] = await Promise.all([
      page<PrepSession>('prep-sessions', 1, { planItemId }, 'startedAt'),
      page<PrepSession>('prep-sessions', 1, { planItemId, state: 'ended' }, 'endedAt'),
      page<PrepSession>('prep-sessions', 1, { planItemId, state: 'ended', outcome: 'completed' }),
    ])
    // Select latest ended FIRST. Empty text never causes an older lookup.
    return { previouslyStarted: !!attempt.records.length, pendingCompletion: !!completion.records.length, latestEnded: ended.records[0] }
  }
  function context(interval?: RecordData<PrepSession>, cap = CONTEXT_LIMITS.previewChars) {
    if (!interval) return null
    const { leftOff, nextStep, endedAt } = interval.data
    return { sessionId: interval.recordId, endedAt, leftOff: leftOff?.slice(0, cap) || null, nextStep: nextStep?.slice(0, cap) || null,
      textTruncated: !!((leftOff?.length ?? 0) > cap || (nextStep?.length ?? 0) > cap) }
  }
  async function snapshot(scope: { prepAreaIds?: string[]; interviewId?: string } = {}, now = Date.now()) {
    // Supplied scopes are IDs only and must resolve through the same RBAC path.
    const scopedAreas = await Promise.all((scope.prepAreaIds ?? []).map((id) => get<PrepArea>('prep-areas', id)))
    const selectedInterview = scope.interviewId ? await get<Interview>('interviews', scope.interviewId) : null
    const [areas, interviews, plans, work, recent, completed, active] = await Promise.all([
      page<PrepArea>('prep-areas', CONTEXT_LIMITS.areas), page<Interview>('interviews', CONTEXT_LIMITS.interviews),
      page<Plan>('plans', CONTEXT_LIMITS.plans), page<PlanItem>('plan-items', CONTEXT_LIMITS.work, { status: 'open' }),
      page<PrepSession>('prep-sessions', CONTEXT_LIMITS.recentIntervals, { state: 'ended' }, 'endedAt'),
      page<PlanItem>('plan-items', CONTEXT_LIMITS.completed, { status: 'completed' }, 'completedAt'),
      page<PrepSession>('prep-sessions', 3, { state: 'active' }, 'startedAt'),
    ])
    const cutoff = new Date(now - recentDays * 86400000).toISOString()
    const candidates = work.records.filter((row) => !scope.prepAreaIds?.length || scope.prepAreaIds.includes(row.data.prepAreaId))
    const openWork = await Promise.all(candidates.map(async (row) => {
      const status = await execution(row.recordId)
      return { id: row.recordId, ...row.data, intent: row.data.intent.slice(0, 1000), previouslyStarted: status.previouslyStarted,
        pendingCompletion: status.pendingCompletion, currentlyFocused: active.records.some((session) => session.data.planItemId === row.recordId),
        planMemberships: plans.records.filter((plan) => plan.data.planItemIds.includes(row.recordId)).map((plan) => ({ id: plan.recordId, title: plan.data.title, closed: !!plan.data.closedAt })),
        latestResumeContext: context(status.latestEnded) }
    }))
    const intervals = recent.records.filter((row) => !!row.data.endedAt && row.data.endedAt >= cutoff)
    const coverage = { areas: areas.coverage, interviews: interviews.coverage, plans: plans.coverage, openWork: work.coverage, completed: completed.coverage, recentIntervals: { ...recent.coverage, returned: intervals.length, since: cutoff, until: new Date(now).toISOString() }, active: active.coverage }
    const notices = Object.entries(coverage).filter(([, entry]) => entry.truncated).map(([key]) => `${key}: only a bounded subset was available.`)
    notices.push(`Focus history covers at most ${CONTEXT_LIMITS.recentIntervals} ended intervals from the last ${recentDays} days; it is not lifetime history.`, 'Plan memberships are limited to the returned Plans. Interview candidates are limited to the most recently created records. Notes and resume-context previews are bounded.')
    return {
      asOf: new Date(now).toISOString(),
      prepAreas: (scopedAreas.length ? scopedAreas : areas.records).map((row) => ({ id: row.recordId, name: row.data.name, notesPreview: row.data.notes?.slice(0, CONTEXT_LIMITS.previewChars) })),
      interviews: [...new Map([...interviews.records.filter((row) => !!row.data.scheduledDate && row.data.scheduledDate >= new Date(now).toISOString().slice(0, 10)), ...(selectedInterview ? [selectedInterview] : [])].map((row) => [row.recordId, row])).values()].map((row) => ({ id: row.recordId, ...row.data, notes: row.data.notes?.slice(0, CONTEXT_LIMITS.previewChars) })),
      openPlans: plans.records.filter((row) => !row.data.closedAt).map((row) => ({ id: row.recordId, ...row.data, planItemIds: row.data.planItemIds.slice(0, 50), membershipTruncated: row.data.planItemIds.length > 50 })),
      openWork,
      currentFocus: active.records.map((row) => ({ id: row.recordId, planItemId: row.data.planItemId, planId: row.data.planId, intent: row.data.intent.slice(0, 1000), startedAt: row.data.startedAt })),
      recentlyCompleted: completed.records.filter((row) => !!row.data.completedAt && row.data.completedAt >= cutoff).map((row) => ({ id: row.recordId, ...row.data, intent: row.data.intent.slice(0, 1000) })),
      recentFocus: intervals.map((row) => ({ planItemId: row.data.planItemId, prepAreaId: row.data.prepAreaId, endedAt: row.data.endedAt, outcome: row.data.outcome, encounteredDifficulty: !!row.data.encounteredStuck, focusMinutes: intervalFocusMs(row.data) / 60000 })),
      coverage, coverageNotices: notices,
    }
  }
  async function workContext(planItemId: string) {
    const item = await get<PlanItem>('plan-items', planItemId)
    const [status, history] = await Promise.all([execution(planItemId), page<PrepSession>('prep-sessions', CONTEXT_LIMITS.detailIntervals, { planItemId, state: 'ended' }, 'endedAt')])
    return { id: item.recordId, ...item.data, ...status, latestEnded: undefined, latestResumeContext: context(status.latestEnded, CONTEXT_LIMITS.detailChars),
      recentIntervals: history.records.map((row) => ({ id: row.recordId, startedAt: row.data.startedAt, endedAt: row.data.endedAt, outcome: row.data.outcome, encounteredDifficulty: !!row.data.encounteredStuck, focusMinutes: intervalFocusMs(row.data) / 60000, notes: row.data.notes?.slice(0, CONTEXT_LIMITS.detailChars), notesTruncated: (row.data.notes?.length ?? 0) > CONTEXT_LIMITS.detailChars })), coverage: history.coverage }
  }
  async function enrich(proposal: Recommendation): Promise<WorkDisplay[]> {
    return Promise.all(proposal.items.map(async (entry) => {
      const existing = entry.kind === 'existing' ? await get<PlanItem>('plan-items', entry.existingPlanItemId) : null
      if (existing && existing.data.status !== 'open') throw new Error('Suggested work is no longer open. Please generate again.')
      const work = existing?.data ?? (entry.kind === 'new' ? entry : null)
      if (!work) throw new Error('Invalid suggested work.')
      const area = await get<PrepArea>('prep-areas', work.prepAreaId)
      const interview = work.interviewId ? await get<Interview>('interviews', work.interviewId) : null
      const status = existing ? await execution(existing.recordId) : null
      if (status?.pendingCompletion) throw new Error('Suggested work needs completion reconciliation. Please generate again.')
      return { intent: work.intent, prepAreaId: area.recordId, prepAreaName: area.data.name, ...(interview ? { interviewId: interview.recordId, interviewCompany: interview.data.company } : {}), previouslyStarted: status?.previouslyStarted ?? false }
    }))
  }
  return { snapshot, workContext, enrich }
}
