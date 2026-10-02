import { useRef, useState } from 'react'

export function useSave(ready: boolean) {
  const locked = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function save(work: () => Promise<void>, message: string) {
    if (!ready || locked.current) return false
    locked.current = true; setBusy(true); setError(''); setNotice('')
    try { await work(); setNotice(message); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save. Try again.'); return false }
    finally { locked.current = false; setBusy(false) }
  }
  return { busy, error, notice, save }
}
