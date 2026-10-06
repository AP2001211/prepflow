import type { PlannerResponse } from '../ai/planner-contract'

export function PlannerSuggestion({ result, selectedIndices, onSelection, disabled, heading }: { result: PlannerResponse; selectedIndices?: number[]; onSelection?: (index: number) => void; disabled?: boolean; heading?: string }) {
  const selectedMinutes = result.recommendation.items.reduce((sum, item, index) => sum + ((selectedIndices?.includes(index) ?? true) ? item.estimatedMinutes : 0), 0)
  return <section aria-label="Suggested plan" className="planner-review">
    <header className="planner-review-heading">
      <h2 className="display-title">{heading ?? result.recommendation.title}</h2>
      <p className="planner-review-total">{selectedMinutes} of {result.availableMinutes} min selected</p>
      <details className="planner-review-rationale"><summary>Why these suggestions?</summary><p>{result.recommendation.rationale}</p></details>
    </header>
    <ol className="recommendation-list">{result.recommendation.items.map((item, index) => {
      const display = result.display[index]!
      return <li key={index} className="recommendation-card" data-selected={selectedIndices ? selectedIndices.includes(index) : true}>
        <label className="recommendation-selection">{onSelection && <input type="checkbox" aria-label={`Include ${display.intent}`} checked={selectedIndices?.includes(index) ?? true} disabled={disabled} onChange={() => onSelection(index)} />}<span className="recommendation-number" aria-hidden="true">{index + 1}</span></label>
        <div className="recommendation-content">
          <div className="recommendation-heading">
            <h3>{display.intent}</h3>
            <span className="recommendation-allocation" aria-label={`${item.estimatedMinutes} minutes suggested allocation`}>{item.estimatedMinutes} min</span>
          </div>
          <p className="recommendation-metadata">{item.kind === 'new' ? 'New activity' : display.previouslyStarted ? 'Previously started' : 'Not started'} · {display.prepAreaName}{display.interviewCompany ? ` · ${display.interviewCompany}` : ''}</p>
          {display.instructions && <p className="recommendation-instructions">{display.instructions}</p>}
          <details className="recommendation-reason"><summary>Why this?</summary><p>{item.reason}</p></details>
        </div>
      </li>
    })}</ol>
    <p className="planner-review-help">Suggested time allocations, not predicted completion times. You don't need to fill every minute.</p>
  </section>
}

export function PlannerCoverage({ notices }: { notices: string[] }) {
  return notices.length > 0 ? <details className="planner-review-coverage"><summary>Context coverage</summary><ul>{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></details> : null
}
