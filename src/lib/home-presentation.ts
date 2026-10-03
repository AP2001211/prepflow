import type { RecordData } from 'deepspace'
import type { Interview } from '../schemas/prep-schema'
import { validPlanDate } from './plan-date'

/** Calendar ordering only: this does not prioritize preparation. */
export function nextInterviews(records: RecordData<Interview>[], today: string) {
  const dated = records.filter((row) => !!row.data.scheduledDate && validPlanDate(row.data.scheduledDate) && row.data.scheduledDate >= today)
  const earliest = dated.reduce<string | undefined>((date, row) => !date || row.data.scheduledDate! < date ? row.data.scheduledDate : date, undefined)
  return earliest ? dated.filter((row) => row.data.scheduledDate === earliest) : []
}
export function localGreeting(now = new Date()) {
  const hour = now.getHours()
  return hour < 12 ? 'Good morning,' : hour < 18 ? 'Good afternoon,' : 'Good evening,'
}
