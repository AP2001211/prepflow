import type { FormEvent } from 'react'
import type { RecordData } from 'deepspace'
import type { PrepArea, Interview } from '../schemas/prep-schema'
import { Button, Input, Textarea } from './ui'
import { Field, Section } from './prep-ui'
import { displayDate } from '../lib/display-date'
import { validPlanDate } from '../lib/plan-date'

export function InterviewContext({ areas, interviews, today, ready, areaName, onCreateInterview }: {
 areas: RecordData<PrepArea>[]; interviews: RecordData<Interview>[]; today: string; ready: boolean; areaName: (id: string) => string; onCreateInterview: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
 const dateGroup = (row: RecordData<Interview>) => !validPlanDate(row.data.scheduledDate ?? '') ? 2 : row.data.scheduledDate! < today ? 1 : 0
 return <div className="preparation-context">
        <Section title="Interviews">
          {!interviews.length && <p className="mb-4 text-sm text-muted-foreground">No interviews added. General preparation works without them.</p>}
          <ul className="context-cards interview-cards">{[...interviews].sort((a, b) => dateGroup(a) - dateGroup(b) || (validPlanDate(a.data.scheduledDate ?? '') ? a.data.scheduledDate! : '9999-99-99').localeCompare(validPlanDate(b.data.scheduledDate ?? '') ? b.data.scheduledDate! : '9999-99-99') || a.recordId.localeCompare(b.recordId)).map((interview) => <li key={interview.recordId} className="break-words"><h3 className="font-medium">{interview.data.company}</h3><p className="text-sm">{[interview.data.role, interview.data.stage].filter(Boolean).join(' · ')}</p><p className="interview-date">{dateGroup(interview) === 1 && 'Past · '}{validPlanDate(interview.data.scheduledDate ?? '') ? displayDate(interview.data.scheduledDate!) : 'Date not set'}</p><p className="text-sm text-muted-foreground">{interview.data.prepAreaIds.length ? interview.data.prepAreaIds.map(areaName).join(', ') : 'No Prep Areas linked'}</p>{interview.data.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{interview.data.notes}</p>}</li>)}</ul>
          <details className="prep-create"><summary>Add Interview</summary><form onSubmit={onCreateInterview}><fieldset disabled={!ready} className="space-y-3">
            <Field label="Company"><Input name="company" required maxLength={200} /></Field>
            <Field label="Role (optional)"><Input name="role" maxLength={200} /></Field>
            <Field label="Date (optional)"><Input name="scheduledDate" type="date" /></Field>
            <Field label="Stage or type (optional)"><Input name="stage" maxLength={200} /></Field>
            <fieldset className="space-y-2"><legend className="mb-2 text-sm">Relevant Prep Areas (optional)</legend>{areas.length ? areas.map((area) => <label key={area.recordId} className="flex items-center gap-2 text-sm"><input type="checkbox" name="prepAreaIds" value={area.recordId} />{area.data.name}</label>) : <p className="text-sm text-muted-foreground">You can create an interview with no linked areas.</p>}</fieldset>
            <Field label="Topics or context (optional)"><Textarea name="notes" maxLength={10000} /></Field>
            <Button type="submit">Create Interview</Button>
          </fieldset></form></details>
        </Section>

 </div>
}

export function PreparationContext({ areas, ready, onCreateArea }: {
 areas: RecordData<PrepArea>[]; ready: boolean; onCreateArea: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
 return <div className="preparation-context">
        <Section title="Prep Areas">
          {!areas.length && <p className="mb-4 text-sm text-muted-foreground">Add anything you want to practice or improve. You choose the names.</p>}
          <ul className="context-cards prep-area-cards">{areas.map((area) => <li key={area.recordId}><h3 className="font-medium break-words">{area.data.name}</h3>{area.data.notes && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{area.data.notes}</p>}</li>)}</ul>
          <details className="prep-create"><summary>Add Prep Area</summary><form onSubmit={onCreateArea}><fieldset disabled={!ready} className="space-y-3"><Field label="Area name"><Input name="name" required maxLength={200} placeholder="For example: PyTorch" /></Field><Field label="Goals or context (optional)"><Textarea name="notes" maxLength={10000} /></Field><Button type="submit">Create Prep Area</Button></fieldset></form></details>
        </Section>
 </div>
}
