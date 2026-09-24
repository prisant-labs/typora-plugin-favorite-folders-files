import { describe, expect, it, vi } from 'vitest'
import { FavoritesController, QuickAccessController } from './controller'
import { applyFavoritesOperation, applyOperation, createFavoritesState, createState, type FavoritesOperation, type Operation } from './model'
import { replayFavoritesDraft, type FavoritesDraft } from './editor-state'

function fixture() {
  let state = createState()
  let listener = () => {}
  const current = { file: 'C:/Synthetic/one.md', folder: 'C:/Synthetic' }
  const store = { read: vi.fn(async () => state), update: vi.fn(async (op: Operation) => state = applyOperation(state, op, 'win32')), close: vi.fn(async () => {}) }
  const host = { platform: 'win32' as const, current: () => ({ ...current }), subscribe: vi.fn((fn: () => void) => { listener = fn; return vi.fn() }), open: vi.fn(async () => {}), reveal: vi.fn(async () => {}) }
  const controller = new QuickAccessController(host, store, { pollMilliseconds: 0 })
  return { controller, host, store, current, emit: () => listener() }
}
describe('observed navigation and persistence', () => {
  it('seeds actual locations and never records a dispatched or canceled request', async () => {
    const f = fixture(); await f.controller.start()
    expect(f.controller.snapshot.state.items).toHaveLength(2)
    await f.controller.open('file', 'C:/Synthetic/canceled.md')
    expect(f.controller.snapshot.state.items.some(item => item.path.endsWith('canceled.md'))).toBe(false)
    f.current.file = 'C:/Synthetic/confirmed.md'; f.emit(); await f.controller.idle()
    expect(f.controller.snapshot.state.items.some(item => item.path.endsWith('confirmed.md'))).toBe(true)
    const writes = f.store.update.mock.calls.length; f.emit(); await f.controller.idle()
    expect(f.store.update).toHaveBeenCalledTimes(writes)
    f.controller.dispose()
  })
  it('keeps corrupt storage visible and prohibits writes', async () => {
    const f = fixture(); f.store.read.mockRejectedValue(new Error('corrupt record'))
    await f.controller.start(); await f.controller.change({ type: 'pin', kind: 'folder', path: 'C:/Synthetic', pinned: true })
    expect(f.controller.snapshot.error).toContain('storage')
    expect(f.store.update).not.toHaveBeenCalled(); f.controller.dispose()
  })
  it('preserves unavailable pins and reports the failed target', async () => {
    const f = fixture(); await f.controller.start()
    await f.controller.change({ type: 'pin', kind: 'file', path: f.current.file, pinned: true })
    f.host.open.mockRejectedValue(new Error('Unavailable file'))
    await f.controller.open('file', f.current.file)
    expect(f.controller.snapshot.unavailable?.size).toBe(1)
    expect(f.controller.snapshot.state.items.find(item => item.kind === 'file')?.pinned).toBe(true)
    f.controller.dispose()
  })
  it('does not publish a pending read or execute queued writes after unload', async () => {
    const f = fixture(); let release!: (value: ReturnType<typeof createState>) => void
    f.store.read.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const publish = vi.fn(); f.controller.subscribe(publish)
    const started = f.controller.start(); await Promise.resolve()
    const change = f.controller.change({ type: 'pin', kind: 'folder', path: 'C:/Synthetic', pinned: true })
    f.controller.dispose(); const calls = publish.mock.calls.length; release(createState())
    await started; await change
    expect(publish).toHaveBeenCalledTimes(calls); expect(f.store.update).not.toHaveBeenCalled()
  })
  it('serializes refresh and queued changes so a slow read cannot overwrite a pin', async () => {
    const f = fixture(); await f.controller.start()
    const old = f.controller.snapshot.state
    let release!: (value: typeof old) => void
    f.store.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const refresh = f.controller.refresh(); await Promise.resolve()
    const pin = f.controller.change({ type: 'pin', kind: 'folder', path: 'C:/Synthetic', pinned: true })
    release(old); await refresh; await pin
    expect(f.controller.snapshot.state.items.find(item => item.kind === 'folder')?.pinned).toBe(true)
    f.controller.dispose()
  })
  it('supports observation without history collection when configured', async () => {
    const f = fixture(); f.controller.dispose()
    const controller = new QuickAccessController(f.host, f.store, { collectHistory: false, pollMilliseconds: 0 })
    await controller.start()
    expect(controller.snapshot.current.file).toBe('C:/Synthetic/one.md')
    expect(f.store.update).not.toHaveBeenCalled(); controller.dispose()
  })
})

function favoritesFixture() {
  let state = createFavoritesState()
  const store = {
    read: vi.fn(async () => state),
    update: vi.fn(async (operation: FavoritesOperation) => state = applyFavoritesOperation(state, operation, 'darwin')),
    commitDraft: vi.fn(async (draft: FavoritesDraft) => state = replayFavoritesDraft(state, draft, 'darwin')),
    close: vi.fn(async () => {}),
  }
  const controller = new FavoritesController(store, 'darwin')
  return { controller, store, get saved() { return state } }
}

describe('Favorites atomic controller', () => {
  it('saves two independently opened drafts without replacing the first result', async () => {
    const fixture = favoritesFixture()
    await fixture.controller.start()
    const first = fixture.controller.beginDraft()
    const second = fixture.controller.beginDraft()
    first.stage({ type: 'group:create', id: 'work', name: 'Work' })
    second.stage({ type: 'group:create', id: 'personal', name: 'Personal' })

    await fixture.controller.saveDraft(first)
    await fixture.controller.saveDraft(second)
    expect(fixture.controller.state.groups.map(group => group.id)).toEqual(['work', 'personal'])
  })

  it('retains a failed draft and keeps the last confirmed state until retry succeeds', async () => {
    const fixture = favoritesFixture()
    await fixture.controller.start()
    const draft = fixture.controller.beginDraft()
    draft.stage({ type: 'group:create', id: 'work', name: 'Work' })
    fixture.store.commitDraft.mockRejectedValueOnce(new Error('Synthetic full database'))

    await expect(fixture.controller.saveDraft(draft)).rejects.toThrow('Synthetic full database')
    expect(draft.status).toBe('editing')
    expect(draft.draft.operations).toHaveLength(1)
    expect(fixture.controller.state).toEqual(createFavoritesState())
    expect(fixture.controller.error).toContain('Synthetic full database')

    await fixture.controller.saveDraft(draft)
    expect(fixture.controller.state.groups.map(group => group.id)).toEqual(['work'])
    expect(fixture.controller.error).toBeUndefined()
  })

  it('coalesces repeated Save through one store commit', async () => {
    const fixture = favoritesFixture()
    await fixture.controller.start()
    const draft = fixture.controller.beginDraft()
    draft.stage({ type: 'group:create', id: 'work', name: 'Work' })
    let release!: (state: ReturnType<typeof createFavoritesState>) => void
    fixture.store.commitDraft.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))

    const first = fixture.controller.saveDraft(draft)
    const second = fixture.controller.saveDraft(draft)
    expect(fixture.store.commitDraft).toHaveBeenCalledOnce()
    release(applyFavoritesOperation(createFavoritesState(), { type: 'group:create', id: 'work', name: 'Work' }, 'darwin'))
    await Promise.all([first, second])
  })
})
