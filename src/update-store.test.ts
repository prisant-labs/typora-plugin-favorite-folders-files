import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNGROUPED_GROUP_ID } from './model'
import { FavoritesIndexedDbStore } from './storage'
import { FavoritesUpdateStore } from './update-store'

const DATABASE = 'favorites-update-synthetic-test'
const stores: Array<{ close(): Promise<void> }> = []
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()))
  vi.unstubAllGlobals()
})
function track<T extends { close(): Promise<void> }>(store: T) { stores.push(store); return store }

async function putRaw(key: string, value: unknown) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('state', 'readwrite')
    transaction.objectStore('state').put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

describe('FavoritesUpdateStore', () => {
  it('reads automatic checks as on when nothing is stored', async () => {
    const store = track(new FavoritesUpdateStore(DATABASE))
    await expect(store.read()).resolves.toEqual({ checkForUpdates: true })
  })

  it('round-trips the setting and the last completed check', async () => {
    const store = track(new FavoritesUpdateStore(DATABASE))
    await expect(store.update(() => ({ checkForUpdates: false, checked: { at: 1_790_000_000_000, version: '0.1.5' } }))).resolves.toEqual({ checkForUpdates: false, checked: { at: 1_790_000_000_000, version: '0.1.5' } })
    await expect(track(new FavoritesUpdateStore(DATABASE)).read()).resolves.toEqual({ checkForUpdates: false, checked: { at: 1_790_000_000_000, version: '0.1.5' } })
  })

  it('reads a malformed record as safe defaults', async () => {
    const cases: Array<[unknown, unknown]> = [
      ['garbage', { checkForUpdates: true }],
      [{ checkForUpdates: 'no' }, { checkForUpdates: true }],
      [{ checkForUpdates: false, checked: { at: 'yesterday' } }, { checkForUpdates: false }],
      [{ checkForUpdates: false, checked: { at: 5, version: 7 } }, { checkForUpdates: false, checked: { at: 5 } }],
      [{ checkForUpdates: false, checked: { at: Number.NaN } }, { checkForUpdates: false }],
    ]
    for (const [raw, expected] of cases) {
      await putRaw('updates', raw)
      const store = track(new FavoritesUpdateStore(DATABASE))
      await expect(store.read()).resolves.toEqual(expected)
      await store.close()
    }
  })

  it('reads defaults and rejects writes when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const store = track(new FavoritesUpdateStore(DATABASE))
    await expect(store.read()).resolves.toEqual({ checkForUpdates: true })
    await expect(store.update(() => ({ checkForUpdates: false }))).rejects.toThrow()
  })

  it('applies concurrent changes from two windows without losing either', async () => {
    const first = track(new FavoritesUpdateStore(DATABASE)), second = track(new FavoritesUpdateStore(DATABASE))
    await Promise.all([
      first.update(record => ({ ...record, checked: { at: 7, version: '0.1.5' } })),
      second.update(record => ({ ...record, checkForUpdates: false })),
    ])
    await expect(first.read()).resolves.toEqual({ checkForUpdates: false, checked: { at: 7, version: '0.1.5' } })
  })

  it('aborts the change when the callback throws', async () => {
    const store = track(new FavoritesUpdateStore(DATABASE))
    await store.update(() => ({ checkForUpdates: false }))
    await expect(store.update(() => { throw new Error('Synthetic failure') })).rejects.toThrow('Synthetic failure')
    await expect(store.read()).resolves.toEqual({ checkForUpdates: false })
  })

  it('creates the shared object store when it opens a new database first', async () => {
    const updates = track(new FavoritesUpdateStore(DATABASE))
    await updates.update(() => ({ checkForUpdates: false }))
    const favorites = track(new FavoritesIndexedDbStore('win32', DATABASE))
    const state = await favorites.read()
    expect(state.favorites).toEqual([])
    await expect(updates.read()).resolves.toEqual({ checkForUpdates: false })
  })

  it('leaves saved Favorites exactly as an older Favorites reads them', async () => {
    const favorites = track(new FavoritesIndexedDbStore('win32', DATABASE))
    await favorites.read()
    const saved = await favorites.update({ type: 'favorite:add', kind: 'folder', path: 'C:/Synthetic/Projects', groupId: UNGROUPED_GROUP_ID })
    await track(new FavoritesUpdateStore(DATABASE)).update(() => ({ checkForUpdates: true, checked: { at: 1, version: '0.1.5' } }))
    // A second window on 0.1.3 opens the same database and reads only its own records.
    const olderWindow = track(new FavoritesIndexedDbStore('win32', DATABASE))
    await expect(olderWindow.read()).resolves.toEqual(saved)
    await expect(olderWindow.update({ type: 'favorites:preferences', patch: { layout: 'stacked' } })).resolves.toMatchObject({ preferences: { layout: 'stacked' } })
    await expect(track(new FavoritesUpdateStore(DATABASE)).read()).resolves.toEqual({ checkForUpdates: true, checked: { at: 1, version: '0.1.5' } })
  })
})
