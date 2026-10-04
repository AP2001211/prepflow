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

it('validates concise new identity and bounded instructions without accepting existing overrides', () => {
  const item = { kind: 'new', intent: 'Course Schedule II — Live Coding', instructions: 'Explain edge cases.', prepAreaId: 'area', estimatedMinutes: 15, reason: 'Interview practice' }
  expect(validateRecommendation({ ...existingProposal, items: [item] }, 30).items[0]).toEqual(item)
  for (const invalid of [{ ...item, intent: 'x'.repeat(201) }, { ...item, instructions: 'x'.repeat(2001) }, { ...existingProposal.items[0], instructions: 'Forged' }]) expect(recommendationSchema.safeParse({ ...existingProposal, items: [invalid] }).success).toBe(false)
  expect(() => validateRecommendation({ ...existingProposal, items: [item, { ...item, instructions: 'Different approach' }] }, 30)).toThrow('repeats new')
})
