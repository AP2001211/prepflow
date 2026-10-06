import { z } from 'zod/v4'
import { validPlanDate } from '../lib/plan-date'

export const recordIdSchema = z.string().min(1).max(200)
export const PLAN_TITLE_MAX_LENGTH = 80
const allocation = { estimatedMinutes: z.number().int().positive().max(1440), reason: z.string().trim().min(1).max(500) }
export const recommendationSchema = z.object({
  title: z.string().trim().min(1).max(PLAN_TITLE_MAX_LENGTH),
  rationale: z.string().trim().min(1).max(1000),
  items: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing'), existingPlanItemId: recordIdSchema, ...allocation }).strict(),
    z.object({ kind: z.literal('new'), intent: z.string().trim().min(1).max(200), instructions: z.string().trim().min(1).max(2000).optional(), prepAreaId: recordIdSchema, interviewId: recordIdSchema.nullish(), ...allocation }).strict(),
  ])).min(1).max(5),
}).strict()
// Previously reviewed proposals remain acceptable/recoverable. This is not
// the schema used for new model output or persisted Plan record reads.
export const legacyRecommendationSchema = recommendationSchema.extend({ title: z.string().trim().min(1).max(200) })
export const plannerRequestSchema = z.object({
  availableMinutes: z.number().int().positive().max(1440),
  planDate: z.string().refine(validPlanDate, 'Invalid target date.').optional(),
  goal: z.string().trim().max(2000).optional(),
  timeZone: z.string().max(100).optional().refine((value) => { try { if (value) new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'Invalid time zone.'),
}).strict().refine((input) => !input.planDate || !!input.timeZone, 'Daily planning requires a timezone.')
export type Recommendation = z.infer<typeof recommendationSchema>
export type PlannerRequest = z.infer<typeof plannerRequestSchema>
export function validateRecommendation(value: unknown, availableMinutes: number): Recommendation {
  return validateProposal(recommendationSchema.parse(value), availableMinutes)
}
export function validateLegacyRecommendation(value: unknown, availableMinutes: number): Recommendation {
  return validateProposal(legacyRecommendationSchema.parse(value), availableMinutes)
}
function validateProposal(proposal: Recommendation, availableMinutes: number): Recommendation {
  const ids = proposal.items.flatMap((item) => item.kind === 'existing' ? [item.existingPlanItemId] : [])
  if (new Set(ids).size !== ids.length) throw new Error('The suggestion repeats existing work. Please generate again.')
  if (proposal.items.reduce((sum, item) => sum + item.estimatedMinutes, 0) > availableMinutes) throw new Error('The suggestion exceeds your available time. Please generate again.')
  const newKeys = proposal.items.flatMap((item) => item.kind === 'new' ? [`${item.prepAreaId}:${item.interviewId ?? ''}:${item.intent.toLowerCase()}`] : [])
  if (new Set(newKeys).size !== newKeys.length) throw new Error('The suggestion repeats new work. Please generate again.')
  return proposal
}
export interface WorkDisplay {
  intent: string
  instructions?: string
  prepAreaId: string
  prepAreaName: string
  interviewId?: string
  interviewCompany?: string
  previouslyStarted: boolean
}
export interface PlannerResponse {
  recommendation: Recommendation
  availableMinutes: number
  totalMinutes: number
  generatedAt: string
  display: WorkDisplay[]
  coverageNotices: string[]
  readTools: string[]
}

/** Validate the HTTP envelope before rendering canonical display references. */
export const plannerResponseSchema = z.object({
  recommendation: recommendationSchema, availableMinutes: z.number().int().positive().max(1440),
  totalMinutes: z.number().int().positive().max(1440), generatedAt: z.string(),
  display: z.array(z.object({ intent: z.string(), instructions: z.string().max(2000).optional(), prepAreaId: recordIdSchema, prepAreaName: z.string(), interviewId: recordIdSchema.optional(), interviewCompany: z.string().optional(), previouslyStarted: z.boolean() }).strict()).min(1).max(5),
  coverageNotices: z.array(z.string()), readTools: z.array(z.enum(['get_prep_snapshot', 'get_work_context'])),
}).strict().refine((data) => data.display.length === data.recommendation.items.length && data.totalMinutes === data.recommendation.items.reduce((sum, item) => sum + item.estimatedMinutes, 0) && data.totalMinutes <= data.availableMinutes, 'Invalid planner response.')
