import { forceCloseDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FavoritesIndexedDbStore, IndexedDbStore } from './storage'
import { applyOperation, createFavoritesState, createState, UNGROUPED_GROUP_ID } from './model'
import { createFavoritesDraft, stageFavoritesDraft } from './editor-state'

const stores: Array<{ close(): Promise<void> }> = []
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()))
  vi.unstubAllGlobals()
})
function store() {
  const instance = new IndexedDbStore('darwin', 'quick-access-synthetic-test')
  stores.push(instance)
  return instance
}

function favoritesStore() {
  const instance = new FavoritesIndexedDbStore('darwin', 'quick-access-synthetic-test')
  stores.push(instance)
  return instance
}

async function rawEntry(key: IDBValidKey, ...values: unknown[]): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('quick-access-synthetic-test', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('state', values.length === 0 ? 'readonly' : 'readwrite')
      const objectStore = transaction.objectStore('state')
      const request = values.length === 0 ? objectStore.get(key) : objectStore.put(values[0], key)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { database.close() }
}

const rawState = (...values: unknown[]) => rawEntry('current', ...values)

describe('transactional location store', () => {
  it('preserves independent preference leaves written concurrently by separate windows', async () => {
    const first = store()
    const second = store()
    await Promise.all([first.read(), second.read()])
    await Promise.all([
      first.update({ type: 'preferences', patch: { pinSort: { file: 'name' }, collapsed: { file: { pinned: true } } } }),
      second.update({ type: 'preferences', patch: { pinSort: { folder: 'name' }, collapsed: { file: { recent: true }, folder: { pinned: true } } } }),
    ])
    const saved = await first.read()
    expect(saved.preferences.pinSort).toEqual({ file: 'name', folder: 'name' })
    expect(saved.preferences.collapsed).toEqual({ file: { pinned: true, recent: true }, folder: { pinned: true, recent: false } })
  })
  it('returns defaults when absent and persists pins across connections without visits', async () => {
    const first = store()
    expect(await first.read()).toEqual(createState())
    const state = await first.update({ type: 'pin', kind: 'file', path: '/Fixture/alpha.md', pinned: true })
    expect(state.items[0].lastVisited).toBeNull()
    await first.close()
    expect(await store().read()).toEqual(state)
  })
  it('serializes concurrent writers and rereads changes instead of resurrecting stale pins', async () => {
    const first = store()
    const second = store()
    await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).update({ type: 'visit', kind: 'file', path: `/Fixture/${index}.md`, at: index })))
    expect((await first.read()).items).toHaveLength(20)
    await first.update({ type: 'pin', kind: 'file', path: '/Fixture/0.md', pinned: true })
    await second.read()
    await first.update({ type: 'pin', kind: 'file', path: '/Fixture/0.md', pinned: false })
    await second.update({ type: 'visit', kind: 'file', path: '/Fixture/new.md', at: 100 })
    expect((await first.read()).items.find(item => item.path === '/Fixture/0.md')?.pinned).toBe(false)
  })
  it('rejects and preserves malformed and unknown-schema data', async () => {
    const first = store()
    await first.read()
    for (const content of [undefined, null, { broken: true }, { ...createState(), version: 99 }, { ...createState(), items: [{}] }]) {
      await rawState(content)
      await expect(first.read()).rejects.toThrow()
      await expect(first.update({ type: 'visit', kind: 'file', path: '/Fixture/alpha.md', at: 1 })).rejects.toThrow()
      expect(await rawState()).toEqual(content)
    }
  })
  it('aborts failed writes without modifying saved data and permits a subsequent update', async () => {
    const first = store()
    const previous = await first.update({ type: 'visit', kind: 'folder', path: '/Fixture', at: 1 })
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Synthetic full database', 'QuotaExceededError') })
    await expect(first.update({ type: 'visit', kind: 'file', path: '/Fixture/alpha.md', at: 2 })).rejects.toThrow('Synthetic full database')
    put.mockRestore()
    expect(await first.read()).toEqual(previous)
    expect((await first.update({ type: 'visit', kind: 'file', path: '/Fixture/beta.md', at: 3 })).items).toHaveLength(2)
  })
  it('preserves saved data after an invalid operation and reports unavailable storage', async () => {
    const first = store()
    const before = await first.update({ type: 'visit', kind: 'folder', path: '/Fixture', at: 1 })
    await expect(first.update({ type: 'visit', kind: 'file', path: 'relative.md', at: 2 })).rejects.toThrow()
    expect(await first.read()).toEqual(before)
    vi.stubGlobal('indexedDB', undefined)
    await expect(store().read()).rejects.toThrow(/IndexedDB.*unavailable/i)
  })
})

describe('transactional Favorites store', () => {
  it('reopens the same store after an abnormal database close without losing saved data', async () => {
    const open = vi.spyOn(indexedDB, 'open')
    const first = favoritesStore()
    const saved = await first.update({ type: 'group:create', id: 'work', name: 'Work' })
    const database = open.mock.results[0].value.result as IDBDatabase
    const closed = new Promise(resolve => database.addEventListener('close', resolve, { once: true }))
    // fake-indexeddb 6.2.5 incorrectly declares the constructor, not an instance.
    ;(forceCloseDatabase as unknown as (connection: IDBDatabase) => void)(database)
    await closed
    expect(await first.read()).toEqual(saved)
    expect((await first.update({ type: 'group:create', id: 'personal', name: 'Personal' })).groups).toHaveLength(2)
    open.mockRestore()
  })

  it('reopens after releasing its connection for a canceled external version upgrade', async () => {
    const first = favoritesStore()
    const saved = await first.update({ type: 'group:create', id: 'work', name: 'Work' })
    await new Promise<void>((resolve, reject) => {
      const upgrade = indexedDB.open('quick-access-synthetic-test', 2)
      upgrade.onupgradeneeded = () => upgrade.transaction!.abort()
      upgrade.onerror = () => resolve()
      upgrade.onsuccess = () => { upgrade.result.close(); reject(new Error('Expected aborted upgrade')) }
      upgrade.onblocked = () => reject(new Error('Favorites did not release its old connection'))
    })
    expect(await first.read()).toEqual(saved)
  })

  it('reports a blocked opening and clears the failed cached connection for retry', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB)
    const opening = vi.spyOn(indexedDB, 'open').mockImplementationOnce((name, version) => {
      const request = originalOpen(name, version)
      queueMicrotask(() => request.onblocked?.call(request, new Event('blocked') as IDBVersionChangeEvent))
      return request
    })
    const first = favoritesStore()
    await expect(first.read()).rejects.toThrow(/blocked by another window/i)
    expect(await first.read()).toEqual(createFavoritesState())
    opening.mockRestore()
  })

  it('writes the untouched raw v1 record as recovery, retaining valid extra fields', async () => {
    const first = favoritesStore()
    await first.read()
    const original = { ...createState(), extra: { nested: ['recovery'], optional: undefined } }
    await rawState(original)
    await first.read()
    expect(await rawEntry('recovery:v1')).toEqual(original)
  })

  it('rejects a recovery mismatch in extra fields without changing either original', async () => {
    const first = favoritesStore()
    await first.read()
    const original = { ...createState(), extra: { nested: ['original'], optional: undefined } }
    const recovery = { ...createState(), extra: { nested: ['different'], optional: undefined } }
    await rawState(original)
    await rawEntry('recovery:v1', recovery)
    await expect(first.read()).rejects.toThrow(/recovery record does not match/i)
    expect(await rawState()).toEqual(original)
    expect(await rawEntry('recovery:v1')).toEqual(recovery)
  })

  it('compares full recovery values without dropping undefined fields or requiring property order', async () => {
    const first = favoritesStore()
    await first.read()
    const original = { ...createState(), extra: { first: 1, optional: undefined } }
    await rawState(original)
    await rawEntry('recovery:v1', { ...createState(), extra: { first: 1 } })
    await expect(first.read()).rejects.toThrow(/recovery record does not match/i)
    await rawEntry('recovery:v1', { ...createState(), extra: { optional: undefined, first: 1 } })
    await expect(first.read()).resolves.toEqual(createFavoritesState())
    expect(await rawEntry('recovery:v1')).toEqual(original)
  })

  it('shares the Favorites database between the v1 reader and v2 store so v1 pins migrate in place', async () => {
    const legacy = new IndexedDbStore('darwin')
    const current = new FavoritesIndexedDbStore('darwin')
    stores.push(legacy, current)
    await legacy.update({ type: 'pin', kind: 'file', path: '/Fixture/existing.md', pinned: true })
    const migrated = await current.read()
    expect(migrated.favorites.map(favorite => favorite.path)).toEqual(['/Fixture/existing.md'])
    expect((await indexedDB.databases()).map(database => database.name)).toEqual(['prisant-labs.favorite-folders-files'])
  })

  it('captures direct operation and draft inputs before waiting for the database', async () => {
    const first = favoritesStore()
    const operation = { type: 'group:create' as const, id: 'work', name: 'Work' }
    const update = first.update(operation)
    operation.name = 'Mutated after request'
    const saved = await update
    expect(saved.groups[0].name).toBe('Work')
    const draft = stageFavoritesDraft(createFavoritesDraft(saved), { type: 'group:create', id: 'personal', name: 'Personal' })
    const commit = first.commitDraft(draft)
    draft.operations.length = 0
    expect((await commit).groups.map(group => group.id)).toEqual(['work', 'personal'])
  })

  it('fails closed when a recovery record remains but current state is missing', async () => {
    const first = favoritesStore()
    await first.read()
    const legacy = applyOperation(createState(), { type: 'pin', kind: 'file', path: '/Fixture/recoverable.md', pinned: true }, 'darwin')
    await rawEntry('recovery:v1', legacy)
    await expect(first.read()).rejects.toThrow(/current.*missing/i)
    await expect(first.update({ type: 'group:create', id: 'work', name: 'Work' })).rejects.toThrow(/current.*missing/i)
    expect(await rawState()).toBeUndefined()
    expect(await rawEntry('recovery:v1')).toEqual(legacy)
  })

  it('preserves both records when an existing recovery backup disagrees with v1 current state', async () => {
    const first = favoritesStore()
    await first.read()
    const recovery = createState()
    const current = applyOperation(recovery, { type: 'pin', kind: 'file', path: '/Fixture/current.md', pinned: true }, 'darwin')
    await rawEntry('recovery:v1', recovery)
    await rawState(current)
    await expect(first.read()).rejects.toThrow(/recovery record does not match/i)
    expect(await rawState()).toEqual(current)
    expect(await rawEntry('recovery:v1')).toEqual(recovery)
  })

  it('atomically migrates v1 and preserves the exact validated recovery record', async () => {
    const first = favoritesStore()
    await first.read()
    let legacy = createState()
    legacy = applyOperation(legacy, { type: 'visit', kind: 'file', path: '/Fixture/recent-only.md', at: 20 }, 'darwin')
    legacy = applyOperation(legacy, { type: 'pin', kind: 'folder', path: '/Fixture/Saved', pinned: true }, 'darwin')
    await rawState(legacy)

    const migrated = await first.read()
    expect(migrated.favorites.map(favorite => favorite.path)).toEqual(['/Fixture/Saved'])
    expect(migrated.itemOrder[UNGROUPED_GROUP_ID]).toEqual(migrated.favorites.map(favorite => favorite.id))
    expect(await rawState()).toEqual(migrated)
    expect(await rawEntry('recovery:v1')).toEqual(legacy)

    expect(await first.read()).toEqual(migrated)
    expect(await rawEntry('recovery:v1')).toEqual(legacy)
  })

  it('rolls back an interrupted migration and remains safe to retry', async () => {
    const first = favoritesStore()
    await first.read()
    const legacy = applyOperation(createState(), { type: 'pin', kind: 'file', path: '/Fixture/saved.md', pinned: true }, 'darwin')
    await rawState(legacy)

    const originalPut = IDBObjectStore.prototype.put
    let writes = 0
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      writes += 1
      if (writes === 2) throw new DOMException('Synthetic interrupted migration', 'QuotaExceededError')
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
    })
    await expect(first.read()).rejects.toThrow('Synthetic interrupted migration')
    put.mockRestore()

    expect(await rawState()).toEqual(legacy)
    expect(await rawEntry('recovery:v1')).toBeUndefined()
    expect((await first.read()).favorites).toHaveLength(1)
    expect(await rawEntry('recovery:v1')).toEqual(legacy)
  })

  it('leaves malformed or unknown records untouched and disables writes', async () => {
    const first = favoritesStore()
    await first.read()
    for (const content of [undefined, null, { broken: true }, { ...createFavoritesState(), version: 99 }]) {
      await rawState(content)
      await expect(first.read()).rejects.toThrow()
      await expect(first.update({ type: 'group:create', id: 'work', name: 'Work' })).rejects.toThrow()
      expect(await rawState()).toEqual(content)
      expect(await rawEntry('recovery:v1')).toBeUndefined()
    }
  })

  it('serializes atomic operations against the latest state across windows', async () => {
    const first = favoritesStore()
    const second = favoritesStore()
    await Promise.all([first.read(), second.read()])
    await Promise.all([
      first.update({ type: 'group:create', id: 'work', name: 'Work' }),
      second.update({ type: 'group:create', id: 'personal', name: 'Personal' }),
    ])
    const saved = await first.read()
    expect(saved.groups.map(group => group.id).sort()).toEqual(['personal', 'work'])
    expect(saved.revision).toBe(2)
  })

  it('replays independent stale drafts inside the latest database transaction', async () => {
    const first = favoritesStore()
    const second = favoritesStore()
    const base = await first.read()
    const work = stageFavoritesDraft(createFavoritesDraft(base), { type: 'group:create', id: 'work', name: 'Work' })
    const personal = stageFavoritesDraft(createFavoritesDraft(base), { type: 'group:create', id: 'personal', name: 'Personal' })

    await Promise.all([first.commitDraft(work), second.commitDraft(personal)])
    expect((await first.read()).groups.map(group => group.id).sort()).toEqual(['personal', 'work'])
  })

  it('rejects a stale deleted destination without changing the latest state', async () => {
    const first = favoritesStore()
    await first.update({ type: 'group:create', id: 'work', name: 'Work' })
    await first.update({ type: 'group:create', id: 'personal', name: 'Personal' })
    await first.update({ type: 'favorite:add', kind: 'file', path: '/Fixture/one.md', groupId: 'work' })
    const base = await first.read()
    const draft = stageFavoritesDraft(createFavoritesDraft(base), {
      type: 'favorite:move',
      favoriteId: base.itemOrder.work[0],
      groupId: 'personal',
    })
    const latest = await first.update({ type: 'group:delete', groupId: 'personal' })

    await expect(first.commitDraft(draft)).rejects.toThrow(/destination.*deleted/i)
    expect(await first.read()).toEqual(latest)
  })
})
