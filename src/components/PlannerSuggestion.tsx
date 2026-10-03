import type { PlannerResponse } from '../ai/planner-contract'

export function PlannerSuggestion({ result }: { result: PlannerResponse }) {
  return <section aria-label="Suggested plan" className="planner-review">
    <h2 className="display-title">{result.recommendation.title}</h2>
    <p>{result.recommendation.rationale}</p>
    <p>{result.availableMinutes} minutes available · {result.totalMinutes} minutes allocated</p>
    <p className="text-sm text-muted-foreground">Suggested time allocations, not predicted completion times.</p>
    <ol className="recommendation-list">{result.recommendation.items.map((item, index) => {
      const display = result.display[index]!
      return <li key={index}><span className="recommendation-number" aria-hidden="true">{index + 1}</span><div>
        <h3 className="font-medium break-words">{display.intent}</h3>
        <p className="text-sm">{item.kind === 'new' ? 'New work' : display.previouslyStarted ? 'Resume' : 'Start'} · {display.prepAreaName}{display.interviewCompany ? ` · ${display.interviewCompany}` : ''}</p>
        <p>{item.estimatedMinutes} minutes suggested allocation</p><p className="text-sm text-muted-foreground">{item.reason}</p>
      </div></li>
    })}</ol>
    {result.coverageNotices.length > 0 && <details className="text-sm text-muted-foreground"><summary>Context coverage</summary><ul>{result.coverageNotices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></details>}
  </section>
}
