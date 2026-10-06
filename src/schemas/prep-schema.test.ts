import { describe, expect, it } from 'vitest'
import { canRead, canCreate, canUpdate, canDelete, checkFieldPermissions, lintSchema } from 'deepspace/worker'
import { prepAreasSchema, interviewsSchema, prepSessionsSchema, plansSchema, planItemsSchema, planAcceptancesSchema } from './prep-schema'

const own = { createdBy: 'alice', data: {} }
describe.each([prepAreasSchema, interviewsSchema, prepSessionsSchema, plansSchema, planItemsSchema, planAcceptancesSchema])('$name privacy', (schema) => {
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

it('keeps explicit check-in optional and action-only', () => {
  expect(prepSessionsSchema.columns.find((column) => column.name === 'lastCheckInAt')).toEqual({ name: 'lastCheckInAt', storage: 'text', interpretation: { kind: 'datetime' } })
  expect(checkFieldPermissions(prepSessionsSchema, 'member', { lastCheckInAt: 'forged' })).not.toBeNull()
})

it('switch reasons are optional bounded session data and cannot be forged through direct client updates', () => {
  const column = prepSessionsSchema.columns.find((field) => field.name === 'switchReason')!
  expect(column.required).not.toBe(true)
  expect(column.interpretation).toEqual({ kind: 'select', options: ['stuck', 'break', 'higher_priority', 'switching_gears'] })
  expect(checkFieldPermissions(prepSessionsSchema, 'member', { switchReason: 'stuck' })).not.toBeNull()
})

it('keeps item availability optional, immutable and date-only, with no session restriction field', () => {
  expect(planItemsSchema.columns.find((c) => c.name === 'availableFrom')).toEqual({ name: 'availableFrom', storage: 'text', interpretation: { kind: 'date' }, immutable: true })
  expect(checkFieldPermissions(planItemsSchema, 'member', { availableFrom: '2099-01-01' })).not.toBeNull()
  expect(prepSessionsSchema.columns.some((c) => c.name === 'availableFrom')).toBe(false)
})

it('acceptance identity and finalization cannot be forged by direct record writes', () => {
  expect(canCreate(planAcceptancesSchema, 'member')).toBe(false)
  expect(checkFieldPermissions(planAcceptancesSchema, 'member', { state: 'applied', acceptedMinutes: 999 })).not.toBeNull()
  expect(lintSchema(planAcceptancesSchema)).toEqual([])
})

it('daily application markers are action-only and additive for legacy Plans', () => {
  expect(plansSchema.columns.find((column) => column.name === 'appliedAcceptanceIds')).toMatchObject({ storage: 'text', interpretation: { kind: 'json' }, default: [] })
  expect(checkFieldPermissions(plansSchema, 'member', { appliedAcceptanceIds: ['forged'] })).not.toBeNull()
})

// Separate strategic collection: no executable fields or direct-write surface.
import { prepPlansSchema } from './prep-schema'
describe('Prep Plan schema boundary', () => {
  it('uses owner-bound composite Interview uniqueness without a default anchor', () => {
    expect(prepPlansSchema.uniqueOn).toEqual(['userId', 'interviewId'])
    expect(prepPlansSchema.columns.find((c) => c.name === 'userId')).toMatchObject({ required: true, immutable: true, userBound: true })
    expect(prepPlansSchema.columns.find((c) => c.name === 'interviewId')).toMatchObject({ immutable: true })
    expect(prepPlansSchema.columns.find((c) => c.name === 'interviewId')).not.toHaveProperty('default')
    expect(lintSchema(prepPlansSchema)).toEqual([])
    for (const field of ['planItemIds', 'planDate', 'budgetMinutes', 'startsAt', 'endsAt', 'closedAt', 'completion']) expect(prepPlansSchema.columns.some((c) => c.name === field)).toBe(false)
  })
  it.each(['viewer', 'member', 'admin'])('allows only owned reads and no direct writes for %s', (role) => {
    expect(canRead(prepPlansSchema, role, own, 'alice')).toBe(true)
    expect(canRead(prepPlansSchema, role, own, 'bob')).toBe(false)
    expect(canCreate(prepPlansSchema, role)).toBe(false)
    expect(canUpdate(prepPlansSchema, role, own, 'alice')).toBe(false)
    expect(canDelete(prepPlansSchema, role, own, 'alice')).toBe(false)
  })
  it('has no public access', () => { expect(canRead(prepPlansSchema, '*', own, 'alice')).toBe(false) })
})
