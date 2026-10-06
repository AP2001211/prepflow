import type { RecordData } from 'deepspace'
import type { Interview } from '../schemas/prep-schema'
import { validPlanDate } from './plan-date'

/** Calendar ordering only: this does not prioritize preparation. */
export function nextInterviews(records: RecordData<Interview>[], today: string) {
  const dated = records.filter((row) => !!row.data.scheduledDate && validPlanDate(row.data.scheduledDate) && row.data.scheduledDate >= today)
  return dated.sort((a, b) => a.data.scheduledDate!.localeCompare(b.data.scheduledDate!) || a.recordId.localeCompare(b.recordId)).slice(0, 3)
}
export function localGreeting(now = new Date()) {
  const hour = now.getHours()
  return hour < 12 ? 'Good morning,' : hour < 18 ? 'Good afternoon,' : 'Good evening,'
}
