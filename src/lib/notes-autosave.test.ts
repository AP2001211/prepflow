import { afterEach, expect, it, vi } from 'vitest'
import { NotesAutosave } from './notes-autosave'
afterEach(() => vi.useRealTimers())
it('debounces typing and preserves whitespace and empty notes', async () => {
  vi.useFakeTimers()
  const write = vi.fn(async (_notes: string) => {})
  const queue = new NotesAutosave(write, vi.fn())
  queue.schedule('first'); queue.schedule('  final\n')
  await vi.advanceTimersByTimeAsync(699); expect(write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1); expect(write).toHaveBeenCalledWith('  final\n')
  queue.schedule(''); await queue.flush(); expect(write).toHaveBeenLastCalledWith('')
  queue.dispose()
})
it('serializes writes and drains older writes before final session actions', async () => {
  vi.useFakeTimers()
  let accept: () => void = () => {}
  const write = vi.fn(() => new Promise<void>((resolve) => { accept = resolve }))
  const queue = new NotesAutosave(write, vi.fn())
  queue.schedule('old'); const saving = queue.flush()
  queue.schedule('newest')
  let settled = false
  const end = queue.settle().then(() => { settled = true })
  expect(settled).toBe(false)
  accept(); await saving; await end
  await vi.runAllTimersAsync()
  expect(write).toHaveBeenCalledTimes(1)
  expect(settled).toBe(true)
  queue.dispose()
})
it('retains failed drafts for retry and cancels timers on disposal', async () => {
  vi.useFakeTimers()
  const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const error = vi.fn()
  const queue = new NotesAutosave(write, error)
  queue.schedule('draft'); await expect(queue.flush()).rejects.toThrow('offline')
  expect(error).toHaveBeenCalledWith(expect.stringContaining('draft is retained'))
  await queue.flush(); expect(write).toHaveBeenLastCalledWith('draft')
  queue.schedule('cancelled'); queue.dispose(); await vi.runAllTimersAsync()
  expect(write).toHaveBeenCalledTimes(2)
})
