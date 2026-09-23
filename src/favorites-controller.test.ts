import { describe, expect, it, vi } from 'vitest'
import { FavoritesController } from './controller'
import { applyFavoritesOperation, createFavoritesState, type FavoritesOperation, type FavoritesState } from './model'
import { createFavoritesDraft, replayFavoritesDraft, stageFavoritesDraft, type FavoritesDraft } from './editor-state'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  let saved = createFavoritesState()
  const store = {
    read: vi.fn(async () => saved),
    update: vi.fn(async (operation: FavoritesOperation) => saved = applyFavoritesOperation(saved, operation, 'darwin')),
    commitDraft: vi.fn(async (draft: FavoritesDraft) => saved = replayFavoritesDraft(saved, draft, 'darwin')),
    close: vi.fn(async () => {}),
  }
  const controller = new FavoritesController(store, 'darwin')
  return { controller, store }
}

const group = (id: string): FavoritesOperation => ({ type: 'group:create', id, name: id })

describe('Favorites controller lifecycle and serialization', () => {
  it('disables edits before a successful read, including while starting and after a failed startup', async () => {
    const { controller, store } = fixture()
    const read = deferred<FavoritesState>()
    store.read.mockReturnValueOnce(read.promise)
    const starting = controller.start()
    expect(() => controller.beginDraft()).toThrow(/not ready/i)
    await expect(controller.change(group('work'))).rejects.toThrow(/not ready/i)
    read.reject(new Error('Unreadable Favorites'))
    await expect(starting).rejects.toThrow('Unreadable Favorites')
    expect(() => controller.beginDraft()).toThrow(/not ready/i)
    await expect(controller.change(group('work'))).rejects.toThrow(/not ready/i)
    expect(store.update).not.toHaveBeenCalled()
  })

  it('recovers through refresh after startup failure and emits confirmed state', async () => {
    const { controller, store } = fixture()
    store.read.mockRejectedValueOnce(new Error('Temporarily unavailable'))
    const observer = vi.fn()
    controller.subscribe(observer)
    await expect(controller.start()).rejects.toThrow('Temporarily unavailable')
    expect(controller.writable).toBe(false)
    await controller.refresh()
    expect(controller.writable).toBe(true)
    expect(controller.error).toBeUndefined()
    await controller.change(group('work'))
    expect(observer.mock.lastCall?.[0].groups).toEqual([{ id: 'work', name: 'work' }])
  })

  it('serializes a slow read and later writes so an older read never replaces a newer save', async () => {
    const { controller, store } = fixture()
    await controller.start()
    const read = deferred<FavoritesState>()
    store.read.mockReturnValueOnce(read.promise)
    const refreshing = controller.refresh()
    const first = controller.change(group('work'))
    const second = controller.change(group('personal'))
    expect(store.update).not.toHaveBeenCalled()
    read.resolve(createFavoritesState())
    await Promise.all([refreshing, first, second])
    await controller.idle()
    expect(controller.state.groups.map(item => item.id)).toEqual(['work', 'personal'])
  })

  it('suppresses pending read publication and queued writes after disposal, then closes safely', async () => {
    const { controller, store } = fixture()
    await controller.start()
    const read = deferred<FavoritesState>()
    store.read.mockReturnValueOnce(read.promise)
    const observer = vi.fn()
    controller.subscribe(observer)
    const refreshing = controller.refresh()
    const writing = controller.change(group('work'))
    controller.dispose()
    const rejection = expect(writing).rejects.toThrow(/disposed/i)
    const calls = observer.mock.calls.length
    expect(store.close).not.toHaveBeenCalled()
    read.resolve(applyFavoritesOperation(createFavoritesState(), group('external'), 'darwin'))
    await refreshing
    await rejection
    await controller.idle()
    await Promise.resolve()
    expect(controller.state.groups).toEqual([])
    expect(observer).toHaveBeenCalledTimes(calls)
    expect(store.update).not.toHaveBeenCalled()
    expect(store.close).toHaveBeenCalledOnce()
  })

  it('does not publish a pending mutation after disposal', async () => {
    const { controller, store } = fixture()
    await controller.start()
    const write = deferred<FavoritesState>()
    store.update.mockReturnValueOnce(write.promise)
    const changing = controller.change(group('work'))
    controller.dispose()
    write.resolve(applyFavoritesOperation(createFavoritesState(), group('work'), 'darwin'))
    await changing
    expect(controller.state.groups).toEqual([])
  })

  it('commits an external draft atomically, snapshots its inputs, and coalesces pending double Save', async () => {
    const { controller, store } = fixture()
    await controller.start()
    const read = deferred<FavoritesState>()
    store.read.mockReturnValueOnce(read.promise)
    const refreshing = controller.refresh()
    const draft = stageFavoritesDraft(createFavoritesDraft(controller.state), group('work'))
    const first = controller.commit(draft)
    const second = controller.commit(draft)
    expect(first).toBe(second)
    draft.operations.length = 0
    read.resolve(createFavoritesState())
    await refreshing
    await first
    expect(store.commitDraft).toHaveBeenCalledOnce()
    expect(controller.state.groups.map(item => item.id)).toEqual(['work'])
  })

  it('keeps observer and returned-state mutations outside its confirmed snapshot', async () => {
    const { controller } = fixture()
    await controller.start()
    controller.subscribe(state => { state.preferences.layout = 'stacked' })
    expect(controller.state.preferences.layout).toBe('tabs')
    const saved = await controller.change(group('work'))
    saved.groups[0].name = 'Changed outside controller'
    controller.state.groups[0].name = 'Another external change'
    expect(controller.state.groups[0].name).toBe('work')
  })

  it('isolates observer failures from a successful save and other observers', async () => {
    const { controller } = fixture()
    await controller.start()
    controller.subscribe(() => { throw new Error('Faulty observer') })
    const observer = vi.fn()
    controller.subscribe(observer)
    await controller.change(group('work'))
    expect(observer.mock.lastCall?.[0].groups).toHaveLength(1)
    expect(controller.error).toBeUndefined()
  })

  it('rejects a regressing persisted revision without replacing confirmed state', async () => {
    const { controller, store } = fixture()
    await controller.start()
    await controller.change(group('work'))
    store.read.mockResolvedValueOnce(createFavoritesState())
    await expect(controller.refresh()).rejects.toThrow(/revision/i)
    expect(controller.state.groups).toHaveLength(1)
    expect(controller.writable).toBe(false)
  })

  it('keeps revision continuity checks active while retrying a failed refresh', async () => {
    const { controller, store } = fixture()
    await controller.start()
    await controller.change(group('work'))
    store.read.mockRejectedValueOnce(new Error('Temporary read failure'))
    await expect(controller.refresh()).rejects.toThrow('Temporary read failure')
    const conflicting = controller.state
    conflicting.groups[0].name = 'Changed without a revision'
    store.read.mockResolvedValueOnce(conflicting)
    await expect(controller.refresh()).rejects.toThrow(/revision/i)
    expect(controller.state.groups[0].name).toBe('work')
  })
})
