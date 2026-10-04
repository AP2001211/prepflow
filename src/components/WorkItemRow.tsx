import { Link } from 'react-router-dom'
import { useQuery, type RecordData } from 'deepspace'
import type { Plan, PlanItem, PrepArea } from '../schemas/prep-schema'
import { itemMemberships } from '../lib/plans'
import { itemFocusMs, formatFocus, itemStatusAt } from '../lib/focus'
import { useFocus } from './FocusController'
import { Button } from './ui'

export function WorkItemRow({ item, plans, plan }: { item: RecordData<PlanItem>; plans: RecordData<Plan>[]; plan?: RecordData<Plan> }) {
  const focus = useFocus()
  const areas = useQuery<PrepArea>('prep-areas')
  const others = itemMemberships(plans, item.recordId).filter((row) => row.recordId !== plan?.recordId)
  const resumed = focus.sessions.records.some((row) => row.data.planItemId === item.recordId && row.data.state === 'ended')
  return <div className="space-y-2 border-b border-border pb-3">
    <h3 className="font-medium break-words">{item.data.intent}</h3>
    {item.data.instructions && <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{item.data.instructions}</p>}
    <p className="text-sm">{areas.records.find((area) => area.recordId === item.data.prepAreaId)?.data.name ?? 'Prep Area'} · {item.data.status} · {resumed ? 'Previously started' : 'Not started'} · {formatFocus(itemFocusMs(focus.sessions.records, item.recordId))} total focus{plan?.data.closedAt ? ` · ${itemStatusAt(item.data, plan.data.closedAt)} when plan closed` : ''}</p>
    {!!others.length && <p className="text-sm text-muted-foreground">{plan ? 'Also included in: ' : 'Included in: '}{others.map((other, index) => <span key={other.recordId}>{index > 0 && ', '}<Link to={`/plans/${other.recordId}`} className="underline">{other.data.title}</Link></span>)}</p>}
    {item.data.status === 'open' && <Button variant="secondary" disabled={!focus.canStart || focus.pendingIds.has(item.recordId)} onClick={() => void focus.start(item.recordId, plan?.data.closedAt ? undefined : plan?.recordId)}>{plan?.data.closedAt ? resumed ? 'Resume outside plan' : 'Start outside plan' : resumed ? 'Resume' : plan ? 'Start planned work' : 'Start work'}</Button>}
  </div>
}
