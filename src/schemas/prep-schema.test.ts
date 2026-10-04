import { describe, expect, it } from 'vitest'
import { canRead, canCreate, canUpdate, canDelete, checkFieldPermissions, lintSchema } from 'deepspace/worker'
import { prepAreasSchema, interviewsSchema, prepSessionsSchema, plansSchema, planItemsSchema } from './prep-schema'

const own = { createdBy: 'alice', data: {} }
describe.each([prepAreasSchema, interviewsSchema, prepSessionsSchema, plansSchema, planItemsSchema])('$name privacy', (schema) => {
  it.each(['member', 'admin'])('restricts %s to their own records, including reads', (role) => {
    expect(canRead(schema, role, own, 'alice')).toBe(true)
    expect(canRead(schema, role, own, 'bob')).toBe(false)
    expect(canUpdate(schema, role, own, 'alice')).toBe(true)
    expect(canUpdate(schema, role, own, 'bob')).toBe(false)
  })
  it('denies anonymous access and viewer writes', () => {
    expect(canRead(schema, '*', own, 'anonymous')).toBe(false)
    expect(canCreate(schema, '*')).toBe(false)
    expect(canUpdate(schema, '*', own, 'alice')).toBe(false)
    expect(canRead(schema, 'viewer', own, 'alice')).toBe(true)
    expect(canRead(schema, 'viewer', own, 'bob')).toBe(false)
    expect(canCreate(schema, 'viewer')).toBe(false)
    expect(canUpdate(schema, 'viewer', own, 'alice')).toBe(false)
  })
  it.each(['*', 'viewer', 'member', 'admin'])('denies deletion for %s', (role) => {
    expect(canDelete(schema, role, own, 'alice')).toBe(false)
  })
  it('passes SDK schema lint', () => { expect(lintSchema(schema)).toEqual([]) })
})
describe('Relationship fields cannot bypass validation', () => {
  it.each(['member', 'admin'])('blocks direct relationship creates and updates for %s', (role) => {
    expect(canCreate(prepAreasSchema, role)).toBe(true)
    expect(canCreate(interviewsSchema, role)).toBe(false)
    expect(canCreate(prepSessionsSchema, role)).toBe(false)
    expect(canCreate(plansSchema, role)).toBe(false)
    expect(canCreate(planItemsSchema, role)).toBe(false)
    expect(checkFieldPermissions(plansSchema, role, { planItemIds: ['foreign'] })).not.toBeNull()
    expect(checkFieldPermissions(plansSchema, role, { closedAt: 'forged' })).not.toBeNull()
    expect(checkFieldPermissions(planItemsSchema, role, { status: 'completed', completedAt: 'forged' })).not.toBeNull()
    expect(checkFieldPermissions(planItemsSchema, role, { intent: 'edited', prepAreaId: 'foreign', interviewId: 'foreign' })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { planItemId: 'foreign', planId: 'foreign', intent: 'forged' })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { leftOff: 'direct', nextStep: 'direct' })).not.toBeNull()
    expect(checkFieldPermissions(interviewsSchema, role, { prepAreaIds: ['foreign'] })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { prepAreaId: 'foreign' })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { interviewId: 'foreign' })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { startedAt: 'forged' })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { notes: 'Blocked' })).toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { encounteredStuck: true })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { state: 'ended', outcome: 'completed', endedAt: '2026-10-01T12:00:00Z' })).not.toBeNull()
  })
})

describe('Phase 2 schemas', () => {
  it('makes semantic item identity and session snapshots immutable', () => {
    for (const field of ['prepAreaId', 'interviewId', 'intent', 'instructions']) {
      expect(planItemsSchema.columns.find((column) => column.name === field)?.immutable).toBe(true)
      expect(prepSessionsSchema.columns.find((column) => column.name === field)?.immutable).toBe(true)
    }
    expect(prepSessionsSchema.columns.find((column) => column.name === 'planItemId')).toMatchObject({ required: true, immutable: true })
    expect(prepSessionsSchema.columns.find((column) => column.name === 'planId')).toMatchObject({ immutable: true })
  })
  it('keeps bounds, completion timestamp and checkpoint optional, without stored duration', () => {
    for (const [schema, fields] of [[plansSchema, ['startsAt', 'endsAt', 'budgetMinutes']], [planItemsSchema, ['completedAt']], [prepSessionsSchema, ['leftOff', 'nextStep', 'planId']]] as const) {
      for (const field of fields) expect(schema.columns.find((column) => column.name === field)?.required).not.toBe(true)
      expect(schema.columns.some((column) => column.name === 'duration')).toBe(false)
    }
    expect(planItemsSchema.columns.find((column) => column.name === 'status')).toMatchObject({ required: true, default: 'open', interpretation: { kind: 'select', options: ['open', 'completed'] } })
  })
})

describe('daily plan schema', () => {
  it('keeps date optional, immutable, without a default and preserves caller binding without date uniqueness', () => {
    expect(plansSchema.columns.find((column) => column.name === 'planDate')).toEqual({ name: 'planDate', storage: 'text', interpretation: { kind: 'date' }, immutable: true })
    expect(plansSchema.columns.find((column) => column.name === 'userId')).toMatchObject({ userBound: true, immutable: true })
    expect(plansSchema.uniqueOn).toBeUndefined()
    expect(plansSchema.ownerField).toBeUndefined()
    expect(lintSchema(plansSchema)).toEqual([])
  })
})

it('keeps instructions optional without a default and blocks direct snapshot edits', () => {
  for (const schema of [planItemsSchema, prepSessionsSchema]) {
    expect(schema.columns.find((column) => column.name === 'instructions')).toEqual({ name: 'instructions', storage: 'text', interpretation: 'plain', immutable: true })
    expect(checkFieldPermissions(schema, 'member', { instructions: 'forged' })).not.toBeNull()
  }
})
