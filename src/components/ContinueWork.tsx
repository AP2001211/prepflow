import { FileText, ArrowRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { PrepArea } from '../schemas/prep-schema'
import { continueItems } from '../lib/focus'
import { useFocus } from './FocusController'

export function ContinueWork() {
  const navigate = useNavigate()
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas')
  const rows = continueItems(focus.items.records, focus.sessions.records)
  if (!rows.length) return null
  return <section className="pick-back-up" aria-label="Pick Back Up"><div className="continuity-heading"><h2>Pick Back Up</h2><Link to="/plans#unfinished-work" aria-label="View all unfinished work">View all →</Link></div>
    <ul className="space-y-3">{rows.slice(0, 3).map(({ item, interval }) => <li key={item.recordId} className="resume-row">
      <span className="secondary-card-icon" aria-hidden="true"><FileText size={20} /></span><div className="continuity-copy"><h3 className="font-medium break-words">{item.data.intent}</h3>
      <p className="text-sm text-muted-foreground">{areas.records.find((area) => area.recordId === item.data.prepAreaId)?.data.name ?? 'Prep Area'}</p>
      {interval.data.leftOff && <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm">Left off: {interval.data.leftOff}</p>}
      {interval.data.nextStep && <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm">Next: {interval.data.nextStep}</p>}
      </div><button type="button" className="secondary-card-action" aria-label="Resume" title="Resume work" disabled={!focus.canStart} onClick={() => void focus.start(item.recordId).then((accepted) => { if (accepted) navigate('/focus') })}><ArrowRight size={18} aria-hidden="true" /></button>
    </li>)}</ul>
  </section>
}
