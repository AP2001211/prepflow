import { useEffect, useState } from 'react'
import { browserDay } from './plan-date'

export function useLocalDay() {
  const [day, setDay] = useState(browserDay)
  useEffect(() => {
    const refresh = () => { const next = browserDay(); setDay((old) => old.planDate === next.planDate && old.timeZone === next.timeZone ? old : next) }
    const timer = window.setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [])
  return day
}
