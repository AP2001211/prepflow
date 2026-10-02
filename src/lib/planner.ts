import { getAuthToken } from 'deepspace'
import { plannerResponseSchema } from '../ai/planner-contract'
import type { PlannerRequest, PlannerResponse } from '../ai/planner-contract'

export async function requestPrepPlan(input: PlannerRequest, signal: AbortSignal): Promise<PlannerResponse> {
  const token = await getAuthToken()
  if (!token) throw new Error('Please sign in again.')
  const response = await fetch('/api/ai/prep-plan', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input) })
  const result = await response.json()
  if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Planning failed. Please retry.')
  const parsed = plannerResponseSchema.safeParse(result)
  if (!parsed.success) throw new Error('A valid suggestion could not be displayed. Please retry.')
  return parsed.data
}
