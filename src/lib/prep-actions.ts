import { getAuthToken } from 'deepspace'

/** Resolve only after the server has accepted the underlying record write. */
export type PrepActionName = 'acceptPrepPlan' | 'createInterview' | 'createPlan' | 'createPlanItem' | 'addPlanItem' | 'closePlan' | 'startPrepSession' | 'endPrepSession' | 'reconcileCompletion' | 'reportStuck' | 'saveResumeContext'
export async function runPrepAction(name: PrepActionName, input: unknown): Promise<string> {
  const token = await getAuthToken()
  if (!token) throw new Error('Please sign in again.')
  const response = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
  const result = await response.json() as { success?: boolean; data?: { recordId?: string }; error?: string }
  if (!response.ok || !result.success || !result.data?.recordId) throw new Error(result.error ?? 'The change could not be saved. Try again.')
  return result.data.recordId
}
