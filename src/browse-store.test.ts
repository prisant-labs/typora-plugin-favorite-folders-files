import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowseStore, cloneBrowseRecord, DEFAULT_BROWSE, normalizeBrowseRecord, type BrowseRecord } from './browse-store'
import { UNGROUPED_GROUP_ID } from './model'
import { FavoritesIndexedDbStore } from './storage'
import { FavoritesUpdateStore } from './update-store'

const DATABASE = 'favorites-browse-synthetic-test'
const stores: Array<{ close(): Promise<void> }> = []
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()))
  vi.unstubAllGlobals()
})
function track<T extends { close(): Promise<void> }>(store: T) { stores.push(store); return store }

describe('Browse record', () => {
  it('reads the defaults when nothing is stored', async () => {
    await expect(track(new BrowseStore('win32', DATABASE)).read()).resolves.toEqual(DEFAULT_BROWSE)
    expect(DEFAULT_BROWSE).toEqual({ roots: [], home: true, drives: true, active: false, collapsed: false, expanded: [], order: ['favorites', 'recent', 'browse'] })
  })

  it('round-trips roots, toggles and expanded folders', async () => {
    const record: BrowseRecord = { roots: ['C:/Synthetic/Projects', 'D:/Archive'], home: false, drives: true, active: true, collapsed: true, expanded: ['folder:c:/synthetic/projects', 'drives'], order: ['browse', 'favorites', 'recent'] }
    await track(new BrowseStore('win32', DATABASE)).update(() => record)
    await expect(track(new BrowseStore('win32', DATABASE)).read()).resolves.toEqual(record)
  })

  it('normalizes root paths and drops invalid or repeated roots', () => {
    const record = normalizeBrowseRecord({ roots: ['C:\\Synthetic\\Projects\\', 'c:/synthetic/projects', 'relative/path', 7, 'D:/'], home: 'yes', active: 1, expanded: ['drives', 3, 'folder:d:/'] }, 'win32')
    expect(record).toEqual({ roots: ['C:/Synthetic/Projects', 'D:/'], home: true, drives: true, active: false, collapsed: false, expanded: ['drives', 'folder:d:/'], order: ['favorites', 'recent', 'browse'] })
    expect(normalizeBrowseRecord({ roots: ['/Synthetic/Notes', '/synthetic/notes'] }, 'darwin').roots).toEqual(['/Synthetic/Notes', '/synthetic/notes'])
    expect(normalizeBrowseRecord('garbage', 'darwin')).toEqual(DEFAULT_BROWSE)
  })

  it('keeps the tab order a full list of the three tabs', () => {
    const order = (value: unknown) => normalizeBrowseRecord({ order: value }, 'win32').order
    expect(order(['browse', 'favorites', 'recent'])).toEqual(['browse', 'favorites', 'recent'])
    // Unknown and repeated names are dropped; missing tabs follow in their usual order.
    expect(order(['browse', 'browse', 'outline', 3])).toEqual(['browse', 'favorites', 'recent'])
    expect(order(['recent'])).toEqual(['recent', 'favorites', 'browse'])
    expect(order('browse')).toEqual(['favorites', 'recent', 'browse'])
    const record = normalizeBrowseRecord({}, 'win32'), copy = cloneBrowseRecord(record)
    copy.order.reverse(); expect(record.order).toEqual(['favorites', 'recent', 'browse'])
  })

  it('keeps at most 50 roots and the 500 most recently expanded folders', () => {
    const roots = Array.from({ length: 60 }, (_, index) => `/Synthetic/Root ${index}`)
    const expanded = Array.from({ length: 520 }, (_, index) => `folder:/synthetic/${index}`)
    const record = normalizeBrowseRecord({ roots, expanded }, 'darwin')
    expect(record.roots).toHaveLength(50); expect(record.roots[0]).toBe('/Synthetic/Root 0')
    expect(record.expanded).toHaveLength(500); expect(record.expanded[0]).toBe('folder:/synthetic/20'); expect(record.expanded.at(-1)).toBe('folder:/synthetic/519')
  })

  it('reads the defaults and rejects writes when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const store = track(new BrowseStore('darwin', DATABASE))
    await expect(store.read()).resolves.toEqual(DEFAULT_BROWSE)
    await expect(store.update(record => ({ ...record, active: true }))).rejects.toThrow()
  })

  it('leaves saved Favorites and the update setting exactly as an older Favorites reads them', async () => {
    const favorites = track(new FavoritesIndexedDbStore('win32', DATABASE))
    await favorites.read()
    const saved = await favorites.update({ type: 'favorite:add', kind: 'folder', path: 'C:/Synthetic/Projects', groupId: UNGROUPED_GROUP_ID })
    await track(new FavoritesUpdateStore(DATABASE)).update(() => ({ checkForUpdates: false }))
    await track(new BrowseStore('win32', DATABASE)).update(record => ({ ...record, active: true, roots: ['C:/Synthetic'] }))
    // A second window on 0.1.4 opens the same database and reads only its own records.
    const olderWindow = track(new FavoritesIndexedDbStore('win32', DATABASE))
    await expect(olderWindow.read()).resolves.toEqual(saved)
    await expect(track(new FavoritesUpdateStore(DATABASE)).read()).resolves.toEqual({ checkForUpdates: false })
    await expect(track(new BrowseStore('win32', DATABASE)).read()).resolves.toMatchObject({ active: true, roots: ['C:/Synthetic'] })
  })
})
