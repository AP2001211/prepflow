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
    {interviews.status === 'ready' && !interviews.error && next.length > 0 && <Link to="/prep" className="home-interview" aria-label="Upcoming interview context">
      <span className="secondary-card-icon" aria-hidden="true"><CalendarDays size={20} /></span><div className="upcoming-copy">{next.length === 1 ? <><span className="font-semibold break-words">{next[0]!.data.company}</span>{next[0]!.data.role && <span className="text-sm break-words">{next[0]!.data.role}</span>}<span className="text-sm text-muted-foreground">{displayDate(next[0]!.data.scheduledDate!, true)}</span></> : <span>{next.length} interviews on {displayDate(next[0]!.data.scheduledDate!, true)}</span>}
    </div><span className="secondary-card-action" aria-hidden="true"><ArrowRight size={18} /></span></Link>}
  </section>
}
