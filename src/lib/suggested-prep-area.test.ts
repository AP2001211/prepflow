import { describe, expect, it, vi } from 'vitest'
import { confirmSuggestedArea } from './suggested-prep-area'

describe('explicit suggested area confirmation', () => {
  const inventory = [{ recordId: 'owned-area', data: { name: 'Quant Math', notes: 'Existing intent' } }]
  it('reuses exact normalized name without mutating or writing existing area', async () => {
    const create = vi.fn()
    expect(await confirmSuggestedArea(' QUANT   math ', 'Changed notes', inventory, create)).toEqual({ area: inventory[0], created: false })
    expect(create).not.toHaveBeenCalled()
    expect(inventory[0]!.data.notes).toBe('Existing intent')
  })
  it('creates only on explicit invocation, retains confirmed ID, and does not fuzzy merge', async () => {
    const create = vi.fn().mockResolvedValue('confirmed-id')
    expect(await confirmSuggestedArea(' Quant Reasoning ', ' Notes ', inventory, create)).toEqual({ area: { recordId: 'confirmed-id', data: { name: 'Quant Reasoning', notes: 'Notes' } }, created: true })
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'Quant Reasoning', notes: 'Notes' })
  })
  it('propagates failure without returning a selectable ID or changing inventory', async () => {
    const before = structuredClone(inventory)
    const create = vi.fn().mockRejectedValue(new Error('Creation unavailable'))
    await expect(confirmSuggestedArea('Probability', '', inventory, create)).rejects.toThrow('Creation unavailable')
    expect(inventory).toEqual(before)
  })
  it.each(['', ' ', 'n'.repeat(201)])('rejects invalid name before writing', async (name) => {
    const create = vi.fn()
    await expect(confirmSuggestedArea(name, '', inventory, create)).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})
