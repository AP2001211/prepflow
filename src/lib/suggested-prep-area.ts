import type { PrepArea } from '../schemas/prep-schema'
import { normalizedAreaName } from '../ai/prep-strategy-contract'

type Area = { recordId: string; data: PrepArea }
/** Explicit user confirmation only. Names never serve as record identity. */
export async function confirmSuggestedArea(name: string, notes: string, inventory: Area[], createConfirmed: (data: PrepArea) => Promise<string>): Promise<{ area: Area; created: boolean }> {
  name = name.trim(); notes = notes.trim()
  if (!name || name.length > 200 || notes.length > 10000) throw new Error('Enter a Prep Area name (up to 200 characters) and notes up to 10000 characters.')
  const match = inventory.find((area) => normalizedAreaName(area.data.name) === normalizedAreaName(name))
  if (match) return { area: match, created: false }
  const recordId = await createConfirmed({ name, notes })
  return { area: { recordId, data: { name, notes } }, created: true }
}
