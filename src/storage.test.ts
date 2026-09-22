import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexedDbStore } from './storage'
import { createState } from './model'

const stores: IndexedDbStore[] = []
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

async function rawState(...values: unknown[]): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('quick-access-synthetic-test', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('state', values.length === 0 ? 'readonly' : 'readwrite')
      const objectStore = transaction.objectStore('state')
      const request = values.length === 0 ? objectStore.get('current') : objectStore.put(values[0], 'current')
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { database.close() }
}

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
