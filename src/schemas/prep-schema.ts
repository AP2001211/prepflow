import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

export interface PrepArea { name: string; notes?: string }
export interface Interview {
  company: string
  role?: string
  scheduledDate?: string
  stage?: string
  prepAreaIds: string[]
  notes?: string
}
export type SessionOutcome = 'completed' | 'stopped' | 'switched'
export interface PrepSession {
  prepAreaId: string
  interviewId?: string
  intent: string
  startedAt: string
  endedAt?: string
  state: 'active' | 'ended'
  outcome?: SessionOutcome
  encounteredStuck: boolean | number
  notes?: string
}

// Relationship-bearing creates go through validated server actions. Direct
// updates cannot change references, including through forged WebSocket writes.
function privatePermissions(create: boolean, writableFields: string[]): Record<string, RolePermissions> {
  return {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create, update: 'own', delete: false, writableFields },
    admin: { read: 'own', create, update: 'own', delete: false, writableFields },
  }
}

export const prepAreasSchema: CollectionSchema = {
  name: 'prep-areas',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
  ],
  permissions: privatePermissions(true, ['name', 'notes']),
}

export const interviewsSchema: CollectionSchema = {
  name: 'interviews',
  columns: [
    { name: 'company', storage: 'text', interpretation: 'plain', required: true },
    { name: 'role', storage: 'text', interpretation: 'plain' },
    { name: 'scheduledDate', storage: 'text', interpretation: { kind: 'date' } },
    { name: 'stage', storage: 'text', interpretation: 'plain' },
    { name: 'prepAreaIds', storage: 'text', interpretation: { kind: 'json' }, default: [] },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
  ],
  permissions: privatePermissions(false, ['company', 'role', 'scheduledDate', 'stage', 'notes']),
}

export const prepSessionsSchema: CollectionSchema = {
  name: 'prep-sessions',
  columns: [
    { name: 'prepAreaId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'prep-areas', displayColumn: 'name' }, required: true, immutable: true },
    { name: 'interviewId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'interviews', displayColumn: 'company' }, immutable: true },
    { name: 'intent', storage: 'text', interpretation: 'plain', required: true },
    { name: 'startedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true, immutable: true },
    { name: 'endedAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'state', storage: 'text', interpretation: { kind: 'select', options: ['active', 'ended'] }, required: true, default: 'active' },
    { name: 'outcome', storage: 'text', interpretation: { kind: 'select', options: ['completed', 'stopped', 'switched'] } },
    { name: 'encounteredStuck', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
  ],
  permissions: privatePermissions(false, ['state', 'outcome', 'endedAt', 'encounteredStuck', 'notes']),
}
