import { Button } from './ui'
import type { SessionOutcome } from '../schemas/prep-schema'

export function FocusCheckIn({ title, onKeep, onEnd }: {
  title: string
  onKeep: () => Promise<boolean>
  onEnd: (outcome: SessionOutcome) => Promise<boolean>
}) {
  return <section className="focus-check-in" aria-label="Focus check-in">
    <div role="status" aria-live="polite"><h4>Still working on {title}?</h4><p>You've been in this focus session for a while.</p></div>
    <div className="focus-check-in-actions">
      <Button onClick={() => void onKeep()}>Keep focusing</Button>
      <Button variant="outline" onClick={() => void onEnd('switched')}>I switched</Button>
      <Button variant="outline" onClick={() => void onEnd('stopped')}>I stopped</Button>
    </div>
  </section>
}
