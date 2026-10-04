import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFocus } from './FocusController'
import { HomeCompletion } from './HomeCompletion'
import { FocusSummary } from './FocusSummary'
import { TodayPlan } from './TodayPlan'

/** Presentation timing only. Accepted completion and records stay in FocusController. */
export function HomePrimary({ planDate }: { planDate: string }) {
  const { completion, setCompletion } = useFocus()
  const frame = useRef<HTMLDivElement>(null)
  const sourceHeight = useRef(0)
  const [phase, setPhase] = useState<'leaving' | 'arriving' | null>(null)
  useEffect(() => {
    if (!completion) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const hold = window.setTimeout(() => {
      if (reduced) setCompletion(null)
      else setPhase('leaving')
    }, 2800)
    const swap = reduced ? undefined : window.setTimeout(() => {
      setPhase('arriving')
      setCompletion(null)
    }, 3450)
    return () => { window.clearTimeout(hold); if (swap !== undefined) window.clearTimeout(swap) }
  }, [completion, setCompletion])
  useEffect(() => {
    if (phase !== 'arriving') return
    const finish = window.setTimeout(() => setPhase(null), 650)
    return () => window.clearTimeout(finish)
  }, [phase])
  // Freeze the outgoing height, then settle to the real incoming content height.
  // Measurements happen before paint so the midpoint never snaps the layout.
  useLayoutEffect(() => {
    const node = frame.current
    if (!node) return
    if (phase === 'leaving') {
      sourceHeight.current = node.offsetHeight
      node.style.height = `${sourceHeight.current}px`
    } else if (phase === 'arriving') {
      node.style.height = 'auto'
      const destinationHeight = node.offsetHeight
      node.style.height = `${sourceHeight.current}px`
      // Establish the starting height before enabling its transition.
      void node.offsetHeight
      node.style.height = `${destinationHeight}px`
    } else {
      node.style.height = ''
    }
  }, [phase])
  const transition = completion ? phase === 'leaving' ? ' is-completion-leaving' : '' : phase === 'arriving' ? ' is-completion-arriving' : ''
  return <div ref={frame} className={`home-primary${transition}`}>
    {completion ? <HomeCompletion completion={completion} /> : <><FocusSummary /><TodayPlan planDate={planDate} /></>}
  </div>
}
