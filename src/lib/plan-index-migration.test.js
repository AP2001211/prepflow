import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Execute the exact static statement shipped by AppRecordRoom against real SQLite.
const worker = readFileSync(new URL('../../worker.ts', import.meta.url), 'utf8')
const statement = worker.match(/this\.sql\.exec\('([^']*DROP INDEX[^']*)'\)/)?.[1]
if (!statement) throw new Error('Missing AppRecordRoom index adjustment')

describe('obsolete daily uniqueness initialization', () => {
  it('preserves rows and unrelated indexes, permits repeated dates, and is idempotent', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE c_plans (_row_id TEXT PRIMARY KEY, _created_by TEXT, col_userid TEXT, col_plandate TEXT, col_title TEXT); CREATE UNIQUE INDEX "uniq_c_plans_userId_planDate" ON c_plans(col_userid, col_plandate); CREATE INDEX unrelated_plan_title ON c_plans(col_title);')
      db.prepare('INSERT INTO c_plans VALUES (?, ?, ?, ?, ?)').run('original', 'alice', 'alice', '2026-10-04', 'Original')
      const before = db.prepare('SELECT * FROM c_plans').all()
      expect(statement).toBe('DROP INDEX IF EXISTS "uniq_c_plans_userId_planDate";')
      db.exec(statement)
      db.exec(statement)
      expect(db.prepare('SELECT * FROM c_plans').all()).toEqual(before)
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name)
      expect(indexes).not.toContain('uniq_c_plans_userId_planDate')
      expect(indexes).toContain('unrelated_plan_title')
      expect(indexes).toContain('sqlite_autoindex_c_plans_1')
      db.prepare('INSERT INTO c_plans VALUES (?, ?, ?, ?, ?)').run('second', 'alice', 'alice', '2026-10-04', 'Second')
      db.prepare('INSERT INTO c_plans VALUES (?, ?, ?, ?, ?)').run('bob', 'bob', 'bob', '2026-10-04', 'Bob')
      expect(db.prepare('SELECT COUNT(*) AS count FROM c_plans').get()?.count).toBe(3)
    } finally { db.close() }
  })
  it('is safe before fresh table initialization', () => {
    const db = new DatabaseSync(':memory:')
    try { db.exec(statement); db.exec(statement); db.exec('CREATE TABLE c_plans (_row_id TEXT PRIMARY KEY)'); expect(db.prepare('SELECT * FROM c_plans').all()).toEqual([]) } finally { db.close() }
  })
})
