import { describe, expect, it } from 'vitest'
import { APICallError } from 'ai'
import { diagnosticText, plannerErrorDiagnostics } from './planner-diagnostics'

describe('planner-only diagnostics', () => {
  it('extracts narrow upstream diagnostics without response extras or request credentials', () => {
    const error = new APICallError({ message: 'unsafe request text', url: 'https://example.invalid', requestBodyValues: { note: 'PRIVATE NOTE' }, statusCode: 400,
      responseBody: JSON.stringify({ error: { type: 'invalid_request_error', message: 'Invalid schema: "PRIVATE CHECKPOINT" Bearer secret-token', extra: 'PRIVATE NOTE' }, request_id: 'req_123', other: 'PRIVATE NOTE' }) })
    const result = plannerErrorDiagnostics(error)
    expect(result.providers).toEqual([{ type: 'invalid_request_error', message: 'Invalid schema: [quoted value redacted] [redacted]', requestId: 'req_123' }])
    expect(result.summary).toContain('status=400')
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|secret-token|unsafe request text/)
  })
  it('bounds and sanitizes messages, omits malformed bodies and arbitrary error messages', () => {
    expect(diagnosticText('x'.repeat(3000))).toHaveLength(500)
    expect(diagnosticText('eyJabc.def.ghi api_key=secret sk-testsecret')).not.toMatch(/eyJ|testsecret|=secret/)
    expect(plannerErrorDiagnostics(new Error('PRIVATE NOTE')).summary).not.toContain('PRIVATE NOTE')
    const error = new APICallError({ message: 'PRIVATE', url: 'https://example.invalid', requestBodyValues: {}, responseBody: 'PRIVATE', statusCode: 400 })
    expect(plannerErrorDiagnostics(error).providers).toEqual([])
  })
  it('retains bounded validation diagnostics through causes without rejected values', () => {
    const result = plannerErrorDiagnostics({ cause: { issues: [{ path: ['items', 0, 'estimatedMinutes'], code: 'invalid_type', message: 'Expected number', input: 'PRIVATE' }, { path: ['PRIVATE FIELD'], code: 'custom', message: 'Invalid "PRIVATE"' }] }, output: 'PRIVATE' })
    expect(result.issues[0]).toEqual({ path: 'items.0.estimatedMinutes', code: 'invalid_type', message: 'Expected number' })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
})
