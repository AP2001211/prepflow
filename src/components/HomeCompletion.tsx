import { Check } from 'lucide-react'
import type { SessionCompletion } from './FocusController'
import { formatFocus } from '../lib/focus'

/** A brief acknowledgement of accepted writes, not an active focus interval. */
export function HomeCompletion({ completion }: { completion: SessionCompletion }) {
  return <section className="home-hero focus-hero home-completion" role="status" aria-label="Work completed">
    <img className="home-focus-artwork" src="/images/illustrations/focus-target.png" width="800" height="800" alt="" aria-hidden="true" />
    <h2 className="eyebrow home-completion-label"><Check size={18} aria-hidden="true" /> Completed</h2>
    <div className="focus-summary-content">
      <h3 className="display-title break-words">{completion.title}</h3>
      <p className="focus-summary-timer">{formatFocus(Math.max(0, Date.parse(completion.endedAt) - Date.parse(completion.startedAt)))} focused</p>
    </div>
  </section>
}
