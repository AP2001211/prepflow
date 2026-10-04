import type { PlannerResponse } from '../ai/planner-contract'

export function PlannerSuggestion({ result }: { result: PlannerResponse }) {
  return <section aria-label="Suggested plan" className="planner-review">
    <header className="planner-review-heading">
      <h2 className="display-title">{result.recommendation.title}</h2>
      <p className="planner-review-rationale">{result.recommendation.rationale}</p>
      <p className="planner-review-total">{result.availableMinutes} minutes available · {result.totalMinutes} minutes allocated</p>
      <p className="planner-review-help">Suggested time allocations, not predicted completion times.</p>
    </header>
    <ol className="recommendation-list">{result.recommendation.items.map((item, index) => {
      const display = result.display[index]!
      return <li key={index} className="recommendation-card">
        <span className="recommendation-number" aria-hidden="true">{index + 1}</span>
        <div className="recommendation-content">
          <div className="recommendation-heading">
            <h3>{display.intent}</h3>
            <span className="recommendation-allocation" aria-label={`${item.estimatedMinutes} minutes suggested allocation`}>{item.estimatedMinutes} min</span>
          </div>
          <p className="recommendation-metadata">{item.kind === 'new' ? 'New work' : display.previouslyStarted ? 'Resume' : 'Start'} · {display.prepAreaName}{display.interviewCompany ? ` · ${display.interviewCompany}` : ''}</p>
          {display.instructions && <p className="recommendation-instructions">Instructions: {display.instructions}</p>}
          <div className="recommendation-reason"><h4>Why this</h4><p>{item.reason}</p></div>
        </div>
      </li>
    })}</ol>
    {result.coverageNotices.length > 0 && <details className="planner-review-coverage"><summary>Context coverage</summary><ul>{result.coverageNotices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></details>}
  </section>
}
