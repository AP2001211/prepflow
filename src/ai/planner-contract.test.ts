import { describe, expect, it } from 'vitest'
import { plannerRequestSchema, recommendationSchema, validateRecommendation } from './planner-contract'
import { existingProposal } from './planner-test-fixture'

describe('Strict planner recommendation contract', () => {
  it('accepts existing and new work with an optional interview', () => {
    const value = { ...existingProposal, items: [...existingProposal.items, { kind: 'new', prepAreaId: 'area', intent: 'Joins', estimatedMinutes: 15, reason: 'Short practice block.' }] }
    expect(validateRecommendation(value, 45)).toEqual(value)
    expect(recommendationSchema.parse({ ...value, items: [{ ...value.items[1], interviewId: null }] }).items).toHaveLength(1)
  })
  it.each([0, -1, 1.5])('rejects invalid allocation %s', (estimatedMinutes) => {
    expect(() => validateRecommendation({ ...existingProposal, items: [{ ...existingProposal.items[0], estimatedMinutes }] }, 30)).toThrow()
  })
  it('rejects budgets, duplicate IDs and duplicate new work', () => {
    expect(() => validateRecommendation(existingProposal, 29)).toThrow('exceeds')
    expect(() => validateRecommendation({ ...existingProposal, items: [...existingProposal.items, ...existingProposal.items] }, 90)).toThrow('repeats existing')
    const item = { kind: 'new', prepAreaId: 'area', intent: 'Joins', estimatedMinutes: 10, reason: 'Practice' }
    expect(() => validateRecommendation({ ...existingProposal, items: [item, item] }, 30)).toThrow('repeats new')
  })
  it('rejects unknown top-level fields, fabricated names, and identity parameters', () => {
    expect(recommendationSchema.safeParse({ ...existingProposal, callerId: 'bob' }).success).toBe(false)
    expect(recommendationSchema.safeParse({ ...existingProposal, items: [{ ...existingProposal.items[0], intent: 'Forged name' }] }).success).toBe(false)
    expect(plannerRequestSchema.safeParse({ availableMinutes: 30, userId: 'bob' }).success).toBe(false)
  })
  it('requires 1–5 items and valid request bounds/time zone', () => {
    for (const items of [[], Array.from({ length: 6 }, () => existingProposal.items[0])]) expect(recommendationSchema.safeParse({ ...existingProposal, items }).success).toBe(false)
    expect(plannerRequestSchema.safeParse({ availableMinutes: 30, timeZone: 'America/New_York' }).success).toBe(true)
    for (const availableMinutes of [0, -1, 1.5, 1441]) expect(plannerRequestSchema.safeParse({ availableMinutes }).success).toBe(false)
    expect(plannerRequestSchema.safeParse({ availableMinutes: 30, timeZone: 'Invalid/Zone' }).success).toBe(false)
  })
})
