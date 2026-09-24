// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoritesController } from './controller'
import { FavoritesRuntime } from './favorites-runtime'
import { applyFavoritesOperation, createFavoritesState, type FavoritesOperation } from './model'
import { replayFavoritesDraft, type FavoritesDraft } from './editor-state'

afterEach(() => { vi.useRealTimers() })

function fixture(options: { readHistory?: () => Promise<unknown>; historyTimeoutMilliseconds?: number; historyMinIntervalMilliseconds?: number; isVisible?: () => boolean } = {}) {
  let saved = createFavoritesState()
  let changed = () => {}
  const current = { file: 'C:\\Fixture\\note.md', folder: 'C:\\Fixture' }
  const detach = vi.fn()
  const host = {
    platform: 'win32' as const, current: () => ({ ...current }),
    subscribe: vi.fn((listener: () => void) => { changed = listener; return detach }),
    open: vi.fn(async () => {}), reveal: vi.fn(async () => {}), dispose: vi.fn(),
  }
  const store = {
    read: vi.fn(async () => saved),
    update: vi.fn(async (operation: FavoritesOperation) => saved = applyFavoritesOperation(saved, operation, 'win32')),
    commitDraft: vi.fn(async (draft: FavoritesDraft) => saved = replayFavoritesDraft(saved, draft, 'win32')),
    close: vi.fn(async () => {}),
  }
  const collection = new FavoritesController(store, 'win32')
  const runtime = new FavoritesRuntime(host, collection, { pollMilliseconds: 0, ...options })
  return { runtime, collection, store, host, current, detach, emit: () => changed() }
}

describe('Favorites native runtime', () => {
  it('reads Typora Recent live only while the panel is visible, into memory, without store writes', async () => {
    let visible = false
    const readHistory = vi.fn(async () => ({ files: [{ path: 'C:/Fixture/Recent.md', date: 10 }], folders: [] }))
    const f = fixture({ readHistory, isVisible: () => visible }); await f.runtime.start()
    await f.runtime.syncHistory(true); expect(readHistory).not.toHaveBeenCalled()
    visible = true; await f.runtime.syncHistory(true)
    expect(readHistory).toHaveBeenCalledOnce()
    expect(f.runtime.snapshot.history.entries).toHaveLength(1)
    expect(f.runtime.snapshot.historySource).toEqual({ available: true, loading: false, error: undefined })
    f.runtime.snapshot.history.entries.splice(0)
    expect(f.runtime.snapshot.history.entries).toHaveLength(1)
    expect(f.store.update).not.toHaveBeenCalled(); expect(f.store.commitDraft).not.toHaveBeenCalled()
    f.runtime.dispose()
  })
  it('re-reads on focus and navigation, throttled, and republishes only a changed list', async () => {
    vi.useFakeTimers()
    const readHistory = vi.fn(async () => ({ files: [{ path: 'C:/Fixture/Recent.md', date: 10 }], folders: [] }))
    const f = fixture({ readHistory, historyMinIntervalMilliseconds: 1000 })
    try {
      await f.runtime.start(); await vi.advanceTimersByTimeAsync(0)
      expect(readHistory).toHaveBeenCalledOnce()
      window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0)
      expect(readHistory).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1000); f.emit(); await vi.advanceTimersByTimeAsync(0)
      expect(readHistory).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1000); window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0)
      expect(readHistory).toHaveBeenCalledTimes(3)
      const listener = vi.fn(); f.runtime.subscribe(listener); listener.mockClear()
      await f.runtime.syncHistory(true); expect(listener).not.toHaveBeenCalled()
      readHistory.mockResolvedValueOnce({ files: [], folders: [] })
      await f.runtime.syncHistory(true)
      expect(listener).toHaveBeenCalledOnce(); expect(f.runtime.snapshot.history.entries).toEqual([])
    } finally { f.runtime.dispose() }
  })
  it('never reads Typora Recent from the storage poll', async () => {
    vi.useFakeTimers()
    const readHistory = vi.fn(async () => ({ files: [], folders: [] }))
    const f = fixture({ readHistory })
    const runtime = new FavoritesRuntime(f.host, f.collection, { pollMilliseconds: 2000, readHistory, historyMinIntervalMilliseconds: 0 })
    try {
      await runtime.start(); await vi.advanceTimersByTimeAsync(0)
      expect(readHistory).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(10000); await runtime.idle()
      expect(f.store.read.mock.calls.length).toBeGreaterThan(2)
      expect(readHistory).toHaveBeenCalledOnce()
    } finally { runtime.dispose(); f.runtime.dispose() }
  })
  it('coalesces reads and never publishes a result that arrives after unload', async () => {
    let release!: (value: unknown) => void
    const readHistory = vi.fn(() => new Promise(resolve => { release = resolve }))
    const f = fixture({ readHistory, isVisible: () => false }); await f.runtime.start()
    const visible = fixture({ readHistory }).runtime
    const first = visible.syncHistory(true); const second = visible.syncHistory(true)
    await Promise.resolve(); expect(readHistory).toHaveBeenCalledOnce()
    expect(visible.snapshot.historySource?.loading).toBe(true)
    const listener = vi.fn(); visible.subscribe(listener); listener.mockClear()
    visible.dispose(); release({ files: [{ path: 'C:/Fixture/Late.md', date: 10 }], folders: [] })
    await Promise.all([first, second])
    expect(visible.snapshot.history.entries).toEqual([]); expect(listener).not.toHaveBeenCalled()
    f.runtime.dispose()
  })
  it('handles reader failure and timeout with safe messages, no retained history, and retries later', async () => {
    vi.useFakeTimers()
    const readHistory = vi.fn<() => Promise<unknown>>().mockRejectedValueOnce(new Error('secret native data'))
    const f = fixture({ readHistory, historyTimeoutMilliseconds: 100 }); await f.runtime.start(); await vi.advanceTimersByTimeAsync(0)
    expect(f.runtime.snapshot.historySource?.error).toContain('Could not read')
    expect(f.runtime.snapshot.historySource?.error).not.toContain('secret')
    expect(f.runtime.snapshot.history.entries).toEqual([])
    readHistory.mockImplementationOnce(() => new Promise(() => {}))
    const reading = f.runtime.syncHistory(true); await vi.advanceTimersByTimeAsync(101); await reading
    expect(f.runtime.snapshot.historySource?.error).toContain('timed out')
    expect(f.runtime.snapshot.historySource?.loading).toBe(false)
    readHistory.mockResolvedValueOnce({ files: [{ path: 'C:/Fixture/Back.md', date: 1 }], folders: [] })
    await f.runtime.syncHistory(true)
    expect(f.runtime.snapshot.historySource?.error).toBeUndefined(); expect(f.runtime.snapshot.history.entries).toHaveLength(1)
    f.runtime.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
  it('never reads on a platform whose Recent reader has not been established', async () => {
    const readHistory = vi.fn(async () => ({ files: [], folders: [] }))
    const f = fixture({ readHistory })
    const mac = new FavoritesRuntime({ ...f.host, platform: 'darwin' }, new FavoritesController(f.store, 'darwin'), { pollMilliseconds: 0, readHistory })
    await mac.start(); await mac.syncHistory(true)
    expect(readHistory).not.toHaveBeenCalled(); expect(mac.snapshot.historySource?.available).toBe(false)
    mac.dispose(); f.runtime.dispose()
  })
  it('observes actual normalized current paths without collecting visits or inventing native history', async () => {
    const f = fixture()
    await f.runtime.start()
    expect(f.runtime.snapshot.current).toEqual({ file: 'C:/Fixture/note.md', folder: 'C:/Fixture' })
    expect(f.runtime.snapshot.history).toMatchObject({ status: 'unavailable', entries: [] })
    expect(f.store.update).not.toHaveBeenCalled()
    await f.runtime.open('file', 'C:/Fixture/requested.md')
    expect(f.runtime.snapshot.current.file).toBe('C:/Fixture/note.md')
    f.current.file = 'C:\\Fixture\\confirmed.md'; f.emit()
    expect(f.runtime.snapshot.current.file).toBe('C:/Fixture/confirmed.md')
    expect(f.store.update).not.toHaveBeenCalled()
    f.runtime.dispose()
  })

  it('ignores unsaved, relative, and non-Markdown active files', async () => {
    const f = fixture()
    await f.runtime.start()
    for (const path of ['', 'Untitled.md', 'C:/Fixture/image.png']) {
      f.current.file = path; f.emit()
      expect(f.runtime.snapshot.current.file).toBeUndefined()
    }
    f.runtime.dispose()
  })

  it('preserves failed navigation targets and clears unavailable state when actual host observation confirms one', async () => {
    const f = fixture()
    await f.runtime.start()
    await f.runtime.change({ type: 'favorite:add', kind: 'file', path: 'C:/Fixture/saved.md', groupId: '__ungrouped__' })
    f.host.open.mockRejectedValueOnce(new Error('Unavailable file'))
    await f.runtime.open('file', 'C:/Fixture/saved.md')
    expect(f.runtime.snapshot.state.favorites).toHaveLength(1)
    expect(f.runtime.snapshot.unavailable?.has('file:c:/fixture/saved.md')).toBe(true)
    expect(f.runtime.snapshot.error).toBe('Unavailable file')
    f.current.file = 'C:/Fixture/saved.md'; f.emit()
    expect(f.runtime.snapshot.unavailable?.size).toBe(0)
    expect(f.runtime.snapshot.error).toBeUndefined()
    f.runtime.dispose()
  })

  it('renders a failed read, stays protected, and recovers on refresh', async () => {
    const f = fixture()
    f.store.read.mockRejectedValueOnce(new Error('Storage unavailable'))
    await f.runtime.start()
    expect(f.runtime.snapshot.error).toBe('Storage unavailable')
    expect(f.runtime.snapshot.writable).toBe(false)
    await f.runtime.refresh()
    expect(f.runtime.snapshot.error).toBeUndefined()
    expect(f.runtime.snapshot.writable).toBe(true)
    f.runtime.dispose()
  })

  it('refreshes on focus, visible documents, and polling, then removes all lifecycle subscriptions', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const runtime = new FavoritesRuntime(f.host, f.collection, { pollMilliseconds: 2000 })
    await runtime.start()
    window.dispatchEvent(new Event('focus')); await runtime.idle()
    document.dispatchEvent(new Event('visibilitychange')); await runtime.idle()
    await vi.advanceTimersByTimeAsync(2000); await runtime.idle()
    expect(f.store.read).toHaveBeenCalledTimes(4)
    runtime.dispose(); await runtime.idle()
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
    expect(f.store.read).toHaveBeenCalledTimes(4)
    expect(f.detach).toHaveBeenCalledOnce()
    expect(f.host.dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not publish delayed navigation or observed changes after disposal', async () => {
    const f = fixture()
    await f.runtime.start()
    let fail!: (error: Error) => void
    f.host.open.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const listener = vi.fn(); f.runtime.subscribe(listener)
    const opening = f.runtime.open('file', 'C:/Fixture/slow.md')
    f.runtime.dispose()
    const count = listener.mock.calls.length
    f.current.file = 'C:/Fixture/other.md'; f.emit(); fail(new Error('Late failure'))
    await opening
    expect(listener).toHaveBeenCalledTimes(count)
    expect(f.runtime.snapshot.error).toBeUndefined()
    expect(f.runtime.snapshot.current.file).toBe('C:/Fixture/note.md')
  })

  it('coalesces simultaneous refresh triggers while a read is pending', async () => {
    const f = fixture()
    await f.runtime.start()
    let release!: (state: ReturnType<typeof createFavoritesState>) => void
    f.store.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = f.runtime.refresh()
    const second = f.runtime.refresh()
    window.dispatchEvent(new Event('focus'))
    release(createFavoritesState())
    await Promise.all([first, second]); await f.runtime.idle()
    expect(f.store.read).toHaveBeenCalledTimes(2)
    f.runtime.dispose()
  })

  it('does not let a late failed navigation replace the result of a newer navigation', async () => {
    const f = fixture()
    await f.runtime.start()
    let fail!: (error: Error) => void
    f.host.open.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const first = f.runtime.open('file', 'C:/Fixture/first.md')
    await f.runtime.open('file', 'C:/Fixture/second.md')
    fail(new Error('Old failure')); await first
    expect(f.runtime.snapshot.error).toBeUndefined()
    f.runtime.dispose()
  })
})
