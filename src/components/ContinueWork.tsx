import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { PrepArea } from '../schemas/prep-schema'
import { continueItems } from '../lib/focus'
import { useFocus } from './FocusController'
import { Section } from './prep-ui'
import { Button } from './ui'

export function ContinueWork() {
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas')
  const rows = continueItems(focus.items.records, focus.sessions.records)
  if (!rows.length) return null
  return <Section title="Continue Where You Left Off">
    <ul className="space-y-3">{rows.slice(0, 3).map(({ item, interval }) => <li key={item.recordId} className="space-y-2 border-b border-border pb-3">
      <h3 className="font-medium break-words">{item.data.intent}</h3>
      <p className="text-sm text-muted-foreground">{areas.records.find((area) => area.recordId === item.data.prepAreaId)?.data.name ?? 'Prep Area'}</p>
      {interval.data.leftOff && <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">Left off: {interval.data.leftOff}</p>}
      {interval.data.nextStep && <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">Next: {interval.data.nextStep}</p>}
      <Button disabled={!focus.canStart} onClick={() => void focus.start(item.recordId)}>Resume</Button>
    </li>)}</ul>
    <Link className="mt-3 inline-block underline" to="/plans#unfinished-work">View all unfinished work →</Link>
  </Section>
}
