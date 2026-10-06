import { CalendarDays, ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { Interview } from '../schemas/prep-schema'
import { displayDate } from '../lib/display-date'
import { localGreeting, nextInterviews } from '../lib/home-presentation'

export function HomeHeading(_props: { planDate: string }) {
  const [greeting, setGreeting] = useState(localGreeting)
  useEffect(() => {
    const refresh = () => setGreeting(localGreeting())
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [])
  return <header className="home-heading">
    <div><h1 className="home-greeting">{greeting.replace(/(morning|afternoon|evening)/, (word) => word[0]!.toUpperCase() + word.slice(1)).replace(/,$/, '')}</h1><p className="home-greeting-detail">Make room for focus.</p></div>
  </header>
}

export function HomeUpcoming({ planDate }: { planDate: string }) {
  const interviews = useQuery<Interview>('interviews')
  const next = nextInterviews(interviews.records, planDate)
  if (interviews.status !== 'ready' || interviews.error || next.length === 0) return null
  return <section className="home-upcoming" aria-label="Upcoming">
    <h2 className="eyebrow">Upcoming</h2>
    <ul className="upcoming-list">{next.map((interview) => <li key={interview.recordId}><Link to="/interviews" className="home-interview" aria-label={`Upcoming interview: ${interview.data.company}`}>
      <span className="secondary-card-icon" aria-hidden="true"><CalendarDays size={20} /></span><div className="upcoming-copy"><span className="font-semibold break-words">{interview.data.company}</span><span className="text-sm break-words">{[interview.data.role, interview.data.stage].filter(Boolean).join(' · ')}</span><span className="text-sm text-muted-foreground">{displayDate(interview.data.scheduledDate!, true)}</span></div><span className="secondary-card-action" aria-hidden="true"><ArrowRight size={18} /></span>
    </Link></li>)}</ul>
  </section>
}
