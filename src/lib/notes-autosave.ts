/** Transient write queue only: the prep-session record remains authoritative. */
export class NotesAutosave {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: string | undefined
  private flight: Promise<void> | undefined
  private disposed = false
  constructor(private write: (notes: string) => Promise<void>, private error: (message: string) => void, private delay = 700) {}
  schedule(notes: string) {
    this.pending = notes
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch(() => {}) }, this.delay)
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.flight) { await this.flight; return this.flush() }
    if (this.pending === undefined || this.disposed) return
    const notes = this.pending
    this.pending = undefined
    this.flight = this.write(notes).then(() => { this.error('') }).catch((cause: unknown) => {
      if (this.pending === undefined) this.pending = notes
      this.error('Session notes could not autosave. Your draft is retained; reconnect or keep typing to retry.')
      throw cause
    })
    try { await this.flight } finally { this.flight = undefined }
    if (this.pending !== undefined) return this.flush()
  }
  /** Difficulty/end already carry final notes. Drain earlier writes first. */
  async settle() {
    clearTimeout(this.timer)
    this.pending = undefined
    try { await this.flight } catch { /* The final action still writes notes. */ }
    this.pending = undefined
  }
  dispose() { clearTimeout(this.timer); this.disposed = true }
}
