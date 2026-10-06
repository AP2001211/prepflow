import type { RecordData } from 'deepspace'
import type { PrepArea, Interview, Plan, PlanItem, PrepSession, PrepPlan } from '../schemas/prep-schema'
import { localPlanDate, planFullyCompleted, validPlanDate } from '../lib/plan-date'
import { isAutomaticallyAvailable } from '../lib/work-availability'
import { intervalFocusMs } from '../lib/focus'
import type { Recommendation, WorkDisplay } from './planner-contract'

export type ToolExecutor = (name: string, params: Record<string, unknown>) => Promise<unknown>
type Result<T> = { success: boolean; data?: { records?: RecordData<T>[]; record?: RecordData<T> }; truncated?: boolean; error?: string }
export const CONTEXT_LIMITS = { areas: 30, interviews: 30, plans: 20, work: 20, recentIntervals: 30, completed: 10, detailIntervals: 5, previewChars: 300, detailChars: 2000, prepPlans: 3, goalPrepPlans: 20, strategyChars: 1000 }
const recentDays = 14

/** Factual observations of returned ended intervals only; no causal interpretation. */
export function observedBehavior(intervals: RecordData<PrepSession>[]) {
  const ended = intervals.filter((row) => row.data.state === 'ended' && !!row.data.endedAt)
  return {
    observedAttemptCount: ended.length,
    observedCompletedCount: ended.filter((row) => row.data.outcome === 'completed').length,
    observedStoppedCount: ended.filter((row) => row.data.outcome === 'stopped').length,
    observedSwitchedCount: ended.filter((row) => row.data.outcome === 'switched').length,
    observedDifficultyCount: ended.filter((row) => !!row.data.encounteredStuck).length,
    observedDifficultyAndSwitchedCount: ended.filter((row) => !!row.data.encounteredStuck && row.data.outcome === 'switched').length,
    observedFocusMinutes: ended.reduce((sum, row) => sum + intervalFocusMs(row.data) / 60000, 0),
    latestObservedAttemptAt: ended.map((row) => row.data.startedAt).filter(Boolean).sort().at(-1) ?? null,
  }
}

// This executor is the SDK's verified-user, RBAC-on path. Never replace it
// with privileged ActionTools, or expose collection/query parameters to the model.
export function prepReader(executor: ToolExecutor, timeZone = 'UTC', targetPlanDate?: string, dailyGoal?: string) {
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
    const intervals = recent.records.filter((row) => !!row.data.endedAt && row.data.endedAt >= cutoff && row.data.endedAt <= new Date(now).toISOString())
    const observationCoverage = { ...recent.coverage, returned: intervals.length, since: cutoff, until: new Date(now).toISOString(), scope: 'caller-wide ended intervals, limited before per-item grouping', lifetime: false }
    const evidenceDate = localPlanDate(timeZone, now)
    const planningDate = targetPlanDate ?? evidenceDate
    const candidates = work.records.filter((row) => isAutomaticallyAvailable(row.data, planningDate)).filter((row) => !scope.prepAreaIds?.length || scope.prepAreaIds.includes(row.data.prepAreaId))
    const openWork = await Promise.all(candidates.map(async (row) => {
      const status = await execution(row.recordId)
      return { id: row.recordId, ...row.data, intent: row.data.intent.slice(0, 1000), instructions: row.data.instructions?.slice(0, CONTEXT_LIMITS.previewChars), instructionsTruncated: (row.data.instructions?.length ?? 0) > CONTEXT_LIMITS.previewChars, behavioralObservations: observedBehavior(intervals.filter((interval) => interval.data.planItemId === row.recordId)), observationCoverage, previouslyStarted: status.previouslyStarted,
        pendingCompletion: status.pendingCompletion, currentlyFocused: active.records.some((session) => session.data.planItemId === row.recordId),
        planMemberships: plans.records.filter((plan) => plan.data.planItemIds.includes(row.recordId)).map((plan) => ({ id: plan.recordId, title: plan.data.title, closed: !!plan.data.closedAt })),
        latestResumeContext: context(status.latestEnded) }
    }))
    // Strategy is a separate bounded read surface, never executable membership.
    const normalizedGoal = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
    const upcoming = interviews.records.filter((row) => validPlanDate(row.data.scheduledDate ?? '') && row.data.scheduledDate! >= planningDate)
      .sort((a, b) => a.data.scheduledDate!.localeCompare(b.data.scheduledDate!) || a.recordId.localeCompare(b.recordId)).slice(0, 3)
    const relevantInterviews = [...new Map([...(selectedInterview ? [selectedInterview] : []), ...upcoming].map((row) => [row.recordId, row])).values()]
    const interviewStrategies = await Promise.all(relevantInterviews.map(async (interview) => {
      const found = await page<PrepPlan>('prep-plans', 1, { interviewId: interview.recordId })
      // Storage uniqueness is authoritative; do not choose ambiguous strategy.
      if (found.coverage.truncated) return []
      return found.records.filter((row) => row.data.interviewId === interview.recordId && !row.data.goal &&
        (interview.recordId === selectedInterview?.recordId || !scope.prepAreaIds?.length || row.data.prepAreaIds.some((id) => scope.prepAreaIds!.includes(id))))
        .map((row) => ({ row, priority: interview.recordId === selectedInterview?.recordId ? 0 : 1, date: interview.data.scheduledDate ?? '' }))
    }))
    const goalStrategies = await page<PrepPlan>('prep-plans', CONTEXT_LIMITS.goalPrepPlans, {}, 'updatedAt')
    const rankedStrategies = [...interviewStrategies.flat(), ...goalStrategies.records.flatMap((row) => {
      if (row.data.interviewId || !row.data.goal?.trim()) return []
      const exact = !!dailyGoal?.trim() && normalizedGoal(row.data.goal) === normalizedGoal(dailyGoal)
      const overlap = !!scope.prepAreaIds?.length && row.data.prepAreaIds.some((id) => scope.prepAreaIds!.includes(id))
      return exact || overlap ? [{ row, priority: exact ? 2 : 3, date: '' }] : []
    })].sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date) || a.row.recordId.localeCompare(b.row.recordId))
    const areaCache = new Map<string, Promise<RecordData<PrepArea> | null>>([...areas.records, ...scopedAreas].map((area) => [area.recordId, Promise.resolve(area)]))
    let unavailableAreaReferences = 0
    let textTruncated = 0
    const prepPlans = await Promise.all(rankedStrategies.slice(0, CONTEXT_LIMITS.prepPlans).map(async ({ row }) => {
      const ids = [...new Set(row.data.prepAreaIds)].slice(0, 30)
      const resolved = await Promise.all(ids.map(async (id) => {
        if (!areaCache.has(id)) areaCache.set(id, get<PrepArea>('prep-areas', id).catch(() => null))
        const area = await areaCache.get(id)!
        if (!area) unavailableAreaReferences++
        return area?.recordId
      }))
      if (row.data.title.length > 80 || row.data.context.length > CONTEXT_LIMITS.strategyChars || (row.data.goal?.length ?? 0) > 500) textTruncated++
      return { id: row.recordId, title: row.data.title.slice(0, 80),
        ...(row.data.interviewId ? { interviewId: row.data.interviewId } : { goal: row.data.goal!.slice(0, 500) }),
        context: row.data.context.slice(0, CONTEXT_LIMITS.strategyChars), prepAreaIds: resolved.filter((id): id is string => !!id) }
    }))
    const strategyCoverage = { returned: prepPlans.length, limit: CONTEXT_LIMITS.prepPlans,
      truncated: rankedStrategies.length > CONTEXT_LIMITS.prepPlans || goalStrategies.coverage.truncated,
      goalCandidates: goalStrategies.coverage, textTruncated, unavailableAreaReferences,
      areaReferencesTruncated: rankedStrategies.slice(0, CONTEXT_LIMITS.prepPlans).some(({ row }) => row.data.prepAreaIds.length > 30) }
    const openPlans = (await Promise.all(plans.records.map(async (row) => {
      if (row.data.closedAt) return null
      if (row.data.planDate) {
        if (row.data.planDate !== planningDate) return null
        // Resolve all membership through RBAC, independently of bounded openWork.
        const members = await Promise.all(row.data.planItemIds.slice(0, 50).map((id) => get<PlanItem>('plan-items', id).catch(() => null)))
        if (row.data.planItemIds.length <= 50 && members.every((item) => !!item) && planFullyCompleted(row, members.filter((item): item is RecordData<PlanItem> => !!item))) return null
      }
      return { id: row.recordId, title: row.data.title, startsAt: row.data.startsAt, endsAt: row.data.endsAt, budgetMinutes: row.data.budgetMinutes, planDate: row.data.planDate, planItemIds: row.data.planItemIds.slice(0, 50), membershipTruncated: row.data.planItemIds.length > 50 }
    }))).filter((row) => row !== null)
    const coverage = { prepPlans: strategyCoverage, areas: areas.coverage, interviews: interviews.coverage, plans: plans.coverage, openWork: work.coverage, completed: completed.coverage, recentIntervals: { ...recent.coverage, returned: intervals.length, since: cutoff, until: new Date(now).toISOString() }, active: active.coverage }
    const notices = Object.entries(coverage).filter(([, entry]) => entry.truncated).map(([key]) => `${key}: only a bounded subset was available.`)
    if (textTruncated || unavailableAreaReferences || strategyCoverage.areaReferencesTruncated) notices.push('Prep Plan strategy text is bounded; unavailable area references are omitted.')
    notices.push('Prep Plan relevance uses bounded Interview candidates and newest updated strategy candidates; unrelated goal strategy is omitted.', `Focus history covers at most ${CONTEXT_LIMITS.recentIntervals} ended intervals from the last ${recentDays} days; it is not lifetime history.`, 'Plan memberships are limited to the returned Plans. Interview candidates are limited to the most recently created records. Notes and resume-context previews are bounded.')
    return {
      asOf: new Date(now).toISOString(),
      evidenceLocalDate: evidenceDate, targetPlanDate: targetPlanDate ?? null, timeZone,
      prepAreas: (scopedAreas.length ? scopedAreas : areas.records).map((row) => ({ id: row.recordId, name: row.data.name, notesPreview: row.data.notes?.slice(0, CONTEXT_LIMITS.previewChars) })),
      interviews: [...new Map([...interviews.records.filter((row) => !!row.data.scheduledDate && row.data.scheduledDate >= planningDate), ...(selectedInterview ? [selectedInterview] : [])].map((row) => [row.recordId, row])).values()].map((row) => ({ id: row.recordId, ...row.data, timingRelativeToPlanDate: !row.data.scheduledDate ? 'unscheduled' : row.data.scheduledDate < planningDate ? 'before' : row.data.scheduledDate === planningDate ? 'on' : 'after', notes: row.data.notes?.slice(0, CONTEXT_LIMITS.previewChars) })),
      prepPlans,
      openPlans,
      openWork,
      currentFocus: active.records.map((row) => ({ id: row.recordId, planItemId: row.data.planItemId, planId: row.data.planId, intent: row.data.intent.slice(0, 1000), encounteredDifficulty: !!row.data.encounteredStuck, startedAt: row.data.startedAt })),
      recentlyCompleted: completed.records.filter((row) => !!row.data.completedAt && row.data.completedAt >= cutoff).map((row) => ({ id: row.recordId, ...row.data, intent: row.data.intent.slice(0, 1000), instructions: row.data.instructions?.slice(0, CONTEXT_LIMITS.previewChars) })),
      recentFocus: intervals.map((row) => ({ planItemId: row.data.planItemId, prepAreaId: row.data.prepAreaId, endedAt: row.data.endedAt, outcome: row.data.outcome, encounteredDifficulty: !!row.data.encounteredStuck, focusMinutes: intervalFocusMs(row.data) / 60000 })),
      coverage, coverageNotices: notices,
    }
  }
  async function workContext(planItemId: string) {
    const item = await get<PlanItem>('plan-items', planItemId)
    if (!isAutomaticallyAvailable(item.data, targetPlanDate ?? localPlanDate(timeZone))) throw new Error('This work is deferred until a later planning date.')
    const [status, history] = await Promise.all([execution(planItemId), page<PrepSession>('prep-sessions', CONTEXT_LIMITS.detailIntervals, { planItemId, state: 'ended' }, 'endedAt')])
    return { id: item.recordId, ...item.data, instructions: item.data.instructions?.slice(0, CONTEXT_LIMITS.detailChars), instructionsTruncated: (item.data.instructions?.length ?? 0) > CONTEXT_LIMITS.detailChars, behavioralObservations: observedBehavior(history.records), observationCoverage: { ...history.coverage, scope: 'latest ended intervals for this item, any age', since: null, oldestReturnedEndedAt: history.records.at(-1)?.data.endedAt ?? null, newestReturnedEndedAt: history.records[0]?.data.endedAt ?? null, lifetime: false }, ...status, latestEnded: undefined, latestResumeContext: context(status.latestEnded, CONTEXT_LIMITS.detailChars),
      recentIntervals: history.records.map((row) => ({ id: row.recordId, startedAt: row.data.startedAt, endedAt: row.data.endedAt, outcome: row.data.outcome, encounteredDifficulty: !!row.data.encounteredStuck, focusMinutes: intervalFocusMs(row.data) / 60000, notes: row.data.notes?.slice(0, CONTEXT_LIMITS.detailChars), notesTruncated: (row.data.notes?.length ?? 0) > CONTEXT_LIMITS.detailChars })), coverage: history.coverage }
  }
  async function enrich(proposal: Recommendation): Promise<WorkDisplay[]> {
    return Promise.all(proposal.items.map(async (entry) => {
      const existing = entry.kind === 'existing' ? await get<PlanItem>('plan-items', entry.existingPlanItemId) : null
      if (existing && !isAutomaticallyAvailable(existing.data, targetPlanDate ?? localPlanDate(timeZone))) throw new Error('This work is deferred until a later planning date.')
      if (existing && existing.data.status !== 'open') throw new Error('Suggested work is no longer open. Please generate again.')
      const work = existing?.data ?? (entry.kind === 'new' ? entry : null)
      if (!work) throw new Error('Invalid suggested work.')
      const area = await get<PrepArea>('prep-areas', work.prepAreaId)
      const interview = work.interviewId ? await get<Interview>('interviews', work.interviewId) : null
      const status = existing ? await execution(existing.recordId) : null
      if (status?.pendingCompletion) throw new Error('Suggested work needs completion reconciliation. Please generate again.')
      return { intent: work.intent, ...(work.instructions ? { instructions: work.instructions } : {}), prepAreaId: area.recordId, prepAreaName: area.data.name, ...(interview ? { interviewId: interview.recordId, interviewCompany: interview.data.company } : {}), previouslyStarted: status?.previouslyStarted ?? false }
    }))
  }
  return { snapshot, workContext, enrich }
}
