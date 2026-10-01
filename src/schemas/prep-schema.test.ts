import { describe, expect, it } from 'vitest'
import { canRead, canCreate, canUpdate, canDelete, checkFieldPermissions, lintSchema } from 'deepspace/worker'
import { prepAreasSchema, interviewsSchema, prepSessionsSchema } from './prep-schema'

const own = { createdBy: 'alice', data: {} }
describe.each([prepAreasSchema, interviewsSchema, prepSessionsSchema])('$name privacy', (schema) => {
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
    expect(checkFieldPermissions(interviewsSchema, role, { prepAreaIds: ['foreign'] })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { prepAreaId: 'foreign' })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { interviewId: 'foreign' })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { startedAt: 'forged' })).not.toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { encounteredStuck: true, notes: 'Blocked' })).toBeNull()
    expect(checkFieldPermissions(prepSessionsSchema, role, { state: 'ended', outcome: 'completed', endedAt: '2026-10-01T12:00:00Z' })).toBeNull()
  })
})
