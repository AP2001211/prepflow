import { useNavigate } from 'react-router-dom'
import { useFocus } from './FocusController'
import { Button, Modal, Textarea } from './ui'
import { Field } from './prep-ui'
import { runPrepAction } from '../lib/prep-actions'

export function ResumeContextDialog() {
  const focus = useFocus()
  const navigate = useNavigate()
  const finish = () => { focus.setContext(null); if (draft?.outcome === 'stopped') navigate('/home') }
  const draft = focus.context
  const interval = focus.sessions.records.find((row) => row.recordId === draft?.sessionId)
  const title = `${draft?.outcome === 'switched' ? 'Switching away from' : 'Stopping'} ${interval?.data.intent ?? 'your work'}`
  return <Modal className="resume-context-dialog" open={!!draft} onClose={() => { if (!focus.busy) focus.setContext(null) }}>
    <Modal.Header><Modal.Title>{title}</Modal.Title></Modal.Header>
    <p className="text-sm text-muted-foreground">Leave yourself a note for when you return. Both fields are optional; {draft?.pendingStop ? 'focus continues until you choose Save or Skip.' : 'focus time has already stopped.'}</p>
    {focus.error && <p role="alert" className="text-destructive">{focus.error}</p>}
    {draft && <form className="overflow-y-auto" onSubmit={(event) => {
      event.preventDefault()
      if (draft.pendingStop) {
        void focus.end(draft.sessionId, 'stopped', { leftOff: draft.leftOff, nextStep: draft.nextStep }).then((accepted) => { if (accepted) navigate('/home') })
        return
      }
      void focus.save(async () => {
        await runPrepAction('saveResumeContext', { sessionId: draft.sessionId, leftOff: draft.leftOff, nextStep: draft.nextStep })
        finish()
      })
    }}>
      <fieldset disabled={!focus.ready} className="space-y-4">
        <Field label="Where did you leave off / what was blocking you? (optional)"><Textarea maxLength={10000} value={draft.leftOff} onChange={(event) => focus.setContext({ ...draft, leftOff: event.target.value })} /></Field>
        <Field label="What should you try next? (optional)"><Textarea maxLength={10000} value={draft.nextStep} onChange={(event) => focus.setContext({ ...draft, nextStep: event.target.value })} /></Field>
        <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => { if (draft.pendingStop) void focus.end(draft.sessionId, 'stopped', {}).then((accepted) => { if (accepted) navigate('/home') }); else finish() }}>Skip</Button><Button type="submit">Save</Button></div>
      </fieldset>
    </form>}
  </Modal>
}
