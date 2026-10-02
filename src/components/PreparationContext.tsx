import type { FormEvent, ReactNode } from 'react'
import type { RecordData } from 'deepspace'
import type { PrepArea, Interview } from '../schemas/prep-schema'
import { Button, Input, Textarea } from './ui'
import { Field, Section } from './prep-ui'

export function PreparationContext({ areas, interviews, ready, areaName, onCreateArea, onCreateInterview }: {
  areas: RecordData<PrepArea>[]
  interviews: RecordData<Interview>[]
  ready: boolean
  areaName: (id: string) => string
  onCreateArea: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onCreateInterview: (event: FormEvent<HTMLFormElement>) => Promise<void>
}): ReactNode {
  return (
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Prep Areas">
          {!areas.length && <p className="mb-4 text-sm text-muted-foreground">Add anything you want to practice or improve. You choose the names.</p>}
          <ul className="mb-5 space-y-3">{areas.map((area) => <li key={area.recordId}><h3 className="font-medium break-words">{area.data.name}</h3>{area.data.notes && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{area.data.notes}</p>}</li>)}</ul>
          <form onSubmit={onCreateArea}><fieldset disabled={!ready} className="space-y-3"><Field label="Area name"><Input name="name" required maxLength={200} placeholder="For example: PyTorch" /></Field><Field label="Goals or context (optional)"><Textarea name="notes" maxLength={10000} /></Field><Button type="submit">Create Prep Area</Button></fieldset></form>
        </Section>
        <Section title="Upcoming Interviews">
          {!interviews.length && <p className="mb-4 text-sm text-muted-foreground">No interviews added. General preparation works without them.</p>}
          <ul className="mb-5 space-y-4">{interviews.map((interview) => <li key={interview.recordId} className="break-words"><h3 className="font-medium">{interview.data.company}</h3><p className="text-sm">{[interview.data.role, interview.data.stage, interview.data.scheduledDate || 'Date not set'].filter(Boolean).join(' · ')}</p><p className="text-sm text-muted-foreground">{interview.data.prepAreaIds.length ? interview.data.prepAreaIds.map(areaName).join(', ') : 'No Prep Areas linked'}</p>{interview.data.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{interview.data.notes}</p>}</li>)}</ul>
          <form onSubmit={onCreateInterview}><fieldset disabled={!ready} className="space-y-3">
            <Field label="Company"><Input name="company" required maxLength={200} /></Field>
            <Field label="Role (optional)"><Input name="role" maxLength={200} /></Field>
            <Field label="Date (optional)"><Input name="scheduledDate" type="date" /></Field>
            <Field label="Stage or type (optional)"><Input name="stage" maxLength={200} /></Field>
            <fieldset className="space-y-2"><legend className="mb-2 text-sm">Relevant Prep Areas (optional)</legend>{areas.length ? areas.map((area) => <label key={area.recordId} className="flex items-center gap-2 text-sm"><input type="checkbox" name="prepAreaIds" value={area.recordId} />{area.data.name}</label>) : <p className="text-sm text-muted-foreground">You can create an interview with no linked areas.</p>}</fieldset>
            <Field label="Topics or context (optional)"><Textarea name="notes" maxLength={10000} /></Field>
            <Button type="submit">Create Interview</Button>
          </fieldset></form>
        </Section>
      </div>
  )
}
