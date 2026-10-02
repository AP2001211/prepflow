import { useState } from 'react'
import { CurrentFocus } from './CurrentFocus'
import { ContinueWork } from './ContinueWork'
import { PlanSummary } from './PlanSummary'
import { WorkItemForm } from './WorkItemForm'
import { Button, Modal } from './ui'
import { useFocus } from './FocusController'

export function PrepWorkspace() {
  const [creating, setCreating] = useState(false)
  const focus = useFocus()
  return <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
    <header><h1 className="text-3xl font-semibold">PrepFlow</h1><p className="mt-2 text-muted-foreground">Focus on your work, continue unfinished work, or choose what to start next.</p></header>
    <CurrentFocus />
    <ContinueWork />
    <PlanSummary />
    <Button disabled={!focus.canStart} onClick={() => setCreating(true)}>Start unplanned work</Button>
    <Modal open={creating} onClose={() => setCreating(false)}><Modal.Header><Modal.Title>Start unplanned work</Modal.Title></Modal.Header><div className="overflow-y-auto"><WorkItemForm startNow onSaved={() => setCreating(false)} /></div></Modal>
  </div>
}
