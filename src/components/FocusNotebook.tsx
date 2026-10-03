import { useEffect, useRef, useState } from 'react'
import { Textarea } from './ui'
import { Field } from './prep-ui'

// Numbers describe visual writing rows, including wrapped lines. The gutter
// follows the native textarea's scroll; nothing is inserted into its value.
export function FocusNotebook({ intent, notes, disabled, onNotes }: { intent: string; notes: string; disabled: boolean; onNotes: (notes: string) => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [viewport, setViewport] = useState({ height: 320, top: 0, rows: 12 })
  useEffect(() => {
    const node = textarea.current
    if (!node) return
    const measure = () => setViewport({ height: node.clientHeight, top: node.scrollTop, rows: Math.max(1, Math.ceil((node.scrollHeight - 40) / 24)) })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    node.addEventListener('scroll', measure)
    return () => { observer.disconnect(); node.removeEventListener('scroll', measure) }
  }, [notes])
  const first = Math.floor(viewport.top / 24)
  const visible = Math.min(Math.ceil(viewport.height / 24) + 2, viewport.rows - first)
  return <div className="focus-notes"><Field label="Session notes — progress, difficulty, or where you stopped">
    <div className="focus-notebook">
      <div className="notebook-heading" aria-hidden="true">/// SESSION NOTES — {intent}</div>
      <div className="notebook-writing">
        <div className="notebook-gutter" aria-hidden="true" style={{ height: viewport.height }}><div style={{ transform: `translateY(-${viewport.top % 24}px)` }}>{Array.from({ length: Math.max(0, visible) }, (_, index) => <span key={first + index}>{first + index + 1}</span>)}</div></div>
        <Textarea ref={textarea} value={notes} onChange={(event) => onNotes(event.target.value)} maxLength={10000} disabled={disabled} />
      </div>
    </div>
  </Field></div>
}
