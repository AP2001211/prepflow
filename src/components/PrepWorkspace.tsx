import { BookOpen, Plus, ArrowRight } from 'lucide-react'
import { HomeHeading, HomeUpcoming } from './HomeHeading'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { FocusSummary } from './FocusSummary'
import { ContinueWork } from './ContinueWork'
import { TodayPlan } from './TodayPlan'
import { WorkItemForm } from './WorkItemForm'
import { Modal } from './ui'
import { useFocus } from './FocusController'
import { useQuery } from 'deepspace'
import type { PrepArea } from '../schemas/prep-schema'
import { useLocalDay } from '../lib/use-local-day'

export function PrepWorkspace() {
  const [creating, setCreating] = useState(false)
  const [selectedArea, setSelectedArea] = useState('')
  const areas = useQuery<PrepArea>('prep-areas', { orderBy: 'createdAt', orderDir: 'desc' })
  const focus = useFocus()
  const day = useLocalDay()
  return <div className="home-layout">
    <HomeHeading planDate={day.planDate} />
    <div className={`home-work-grid${focus.active.length ? ' home-has-focus' : ''}`}>
      <div className="home-primary"><FocusSummary /><TodayPlan planDate={day.planDate} /></div>
      <div className="home-secondary-rail"><ContinueWork /><HomeUpcoming planDate={day.planDate} /></div>
    </div>
    <section className="home-start-other" aria-label="Start something else">
      <div><h2>Start something else</h2><p className="text-sm text-muted-foreground">Choose a prep area to work outside today’s plan.</p></div>
      <div className="prep-area-objects">
        {areas.status === 'ready' && !areas.error && areas.records.map((area) => <button key={area.recordId} type="button" className="prep-area-object" disabled={!focus.canStart} onClick={() => { setSelectedArea(area.recordId); setCreating(true) }}>
          <span className="secondary-card-icon" aria-hidden="true"><BookOpen size={20} /></span><span className="prep-area-object-copy"><span className="prep-area-object-title">{area.data.name}</span>
          {area.data.notes && <span className="prep-area-object-description">{area.data.notes}</span>}
          </span><span className="secondary-card-action" aria-hidden="true"><ArrowRight size={18} /></span>
        </button>)}
        <Link to="/prep" className="prep-area-object prep-area-object-add"><span className="prep-area-object-copy"><span className="prep-area-object-title">Add area</span><span className="prep-area-object-description">Create a custom prep area</span></span><span className="secondary-card-action" aria-hidden="true"><Plus size={18} /></span></Link>
      </div>
    </section>
    <Modal open={creating} onClose={() => setCreating(false)}><Modal.Header><Modal.Title>Start something else</Modal.Title></Modal.Header><div className="overflow-y-auto"><WorkItemForm initialPrepAreaId={selectedArea} startNow onSaved={() => setCreating(false)} /></div></Modal>
  </div>
}
