import { APICallError } from 'ai'
import { deepSpaceAgentErrorSummary } from 'deepspace/worker'

/** Never serialize errors, outputs, headers or inputs. Only select diagnostics. */
export function diagnosticText(value: string): string {
  return value.slice(0, 2000)
    .replace(/Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+|(?:sk-|sk_)[\w-]+/gi, '[redacted]')
    .replace(/(?:authorization|api[_ -]?key|jwt|token|secret|password)\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, '[quoted value redacted]')
    .replace(/[\r\n\t]/g, ' ').slice(0, 500)
}

export function plannerErrorDiagnostics(error: unknown) {
  const providers: { type?: string; message?: string; requestId?: string }[] = []
  const issues: { path: string; code: string; message: string }[] = []
  const pending: unknown[] = [error]
  const visited = new Set<unknown>()
  while (pending.length && visited.size < 8) {
    const current = pending.shift()
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    if (APICallError.isInstance(current) && typeof current.responseBody === 'string' && current.responseBody.length <= 16000) {
      try {
        const body: unknown = JSON.parse(current.responseBody)
        if (body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object') {
          const detail = body.error
          providers.push({
            type: 'type' in detail && typeof detail.type === 'string' ? diagnosticText(detail.type) : undefined,
            message: 'message' in detail && typeof detail.message === 'string' ? diagnosticText(detail.message) : undefined,
            requestId: 'request_id' in body && typeof body.request_id === 'string' ? diagnosticText(body.request_id) : undefined,
          })
        }
      } catch { /* Never log the unparsed body. */ }
    }
    if ('issues' in current && Array.isArray(current.issues)) {
      for (const issue of current.issues.slice(0, 5)) {
        if (!issue || typeof issue !== 'object') continue
        issues.push({
          path: Array.isArray(issue.path) ? issue.path.slice(0, 8).map((part: unknown) => typeof part === 'number' ? part : typeof part === 'string' && /^(items|title|rationale|kind|intent|instructions|prepAreaId|interviewId|existingPlanItemId|estimatedMinutes|reason)$/.test(part) ? part : '[field]').join('.') : '',
          code: typeof issue.code === 'string' ? diagnosticText(issue.code) : 'unknown',
          message: typeof issue.message === 'string' ? diagnosticText(issue.message) : 'Validation failed',
        })
      }
    }
    if ('cause' in current) pending.push(current.cause)
    if ('lastError' in current) pending.push(current.lastError)
  }
  // SDK summaries may include arbitrary exception messages; retain safe metadata only.
  const summary = deepSpaceAgentErrorSummary(error).replace(/message=.*?(?= (?:status|code|requestId|upstreamCode|upstreamRequestId)=| <- |$)/g, 'message=[omitted]')
  return { summary: diagnosticText(summary), providers, issues: issues.slice(0, 5) }
}
