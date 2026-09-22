import { describe, expect, it } from 'vitest'
import { applyOperation, createState, isWithin, locationId, normalizePath, selectLocations, validateState } from './model'

describe('absolute location identity', () => {
  it('normalizes Windows drives and UNC roots without crossing their root', () => {
    expect(normalizePath('C:\\Fixture\\Notes\\..\\Alpha.md', 'win32')).toBe('C:/Fixture/Alpha.md')
    expect(normalizePath('\\\\server\\share\\..\\..\\Folder\\', 'win32')).toBe('//server/share/Folder')
    expect(locationId('file', 'C:/Fixture/Alpha.md', 'win32')).toBe(locationId('file', 'c:/fixture/ALPHA.md', 'win32'))
    expect(locationId('file', '/Fixture/Alpha.md', 'darwin')).not.toBe(locationId('file', '/Fixture/alpha.md', 'darwin'))
  })
  it('rejects relative paths, incomplete network roots, and control characters', () => {
    for (const value of ['C:relative', '\\relative', '//server', 'relative', 'C:/bad\nname']) {
      expect(() => normalizePath(value, 'win32')).toThrow()
    }
    expect(() => normalizePath('relative', 'darwin')).toThrow()
    expect(normalizePath('/../../Fixture/./notes/', 'darwin')).toBe('/Fixture/notes')
    expect(normalizePath('/Fixture/back\\slash.md', 'darwin')).toBe('/Fixture/back\\slash.md')
  })
  it('uses component boundaries for containment and accepts roots themselves', () => {
    expect(isWithin('C:/Fixture/notes/a.md', 'c:/fixture', 'win32')).toBe(true)
    expect(isWithin('C:/Fixture-copy/a.md', 'C:/Fixture', 'win32')).toBe(false)
    expect(isWithin('//host/share/file', '//HOST/SHARE/', 'win32')).toBe(true)
    expect(isWithin('/Fixture/a', '/', 'darwin')).toBe(true)
    expect(isWithin('/fixture/a', '/Fixture', 'darwin')).toBe(false)
    expect(isWithin('/Fixture', '/Fixture', 'darwin')).toBe(true)
  })
})

describe('location state', () => {
  it('patches only specified preference leaves without changing sibling values or its input', () => {
    const initial = createState()
    const first = applyOperation(initial, { type: 'preferences', patch: { pinSort: { file: 'name' }, collapsed: { file: { pinned: true }, folder: { recent: true } } } }, 'darwin')
    const second = applyOperation(first, { type: 'preferences', patch: { pinSort: { folder: 'name' }, collapsed: { file: { recent: true } } } }, 'darwin')
    expect(second.preferences.pinSort).toEqual({ file: 'name', folder: 'name' })
    expect(second.preferences.collapsed).toEqual({ file: { pinned: true, recent: true }, folder: { pinned: false, recent: true } })
    expect(first.preferences.collapsed.file).toEqual({ pinned: true, recent: false })
    expect(initial).toEqual(createState())
  })
  it('starts with the agreed recent limits and keeps unvisited pins out of recents after unpinning', () => {
    const initial = createState()
    expect(initial.preferences).toMatchObject({ recentFiles: 20, recentFolders: 10 })
    const pinned = applyOperation(initial, { type: 'pin', kind: 'file', path: '/Fixture/new.md', pinned: true }, 'darwin')
    const unpinned = applyOperation(pinned, { type: 'pin', kind: 'file', path: '/Fixture/new.md', pinned: false }, 'darwin')
    expect(selectLocations(unpinned, { kind: 'file', query: '', root: null, platform: 'darwin' })).toEqual({ pinned: [], recent: [], total: 0 })
  })
  it('pins without fabricating visits and preserves visit time when toggling pins', () => {
    const initial = createState()
    const pinned = applyOperation(initial, { type: 'pin', kind: 'file', path: '/Fixture/alpha.md', pinned: true }, 'darwin')
    expect(initial.items).toEqual([])
    expect(pinned.items[0]).toMatchObject({ pinned: true, lastVisited: null, name: 'alpha.md' })
    const visited = applyOperation(pinned, { type: 'visit', kind: 'file', path: '/Fixture/alpha.md', at: 42 }, 'darwin')
    const unpinned = applyOperation(visited, { type: 'pin', kind: 'file', path: '/Fixture/alpha.md', pinned: false }, 'darwin')
    expect(unpinned.items[0]).toMatchObject({ pinned: false, lastVisited: 42 })
    expect(applyOperation(initial, { type: 'pin', kind: 'file', path: '/Fixture/missing.md', pinned: false }, 'darwin').items).toEqual([])
  })
  it('deduplicates Windows paths and separates folders from files', () => {
    let state = applyOperation(createState(), { type: 'visit', kind: 'file', path: 'C:/Fixture/Alpha.md', at: 1 }, 'win32')
    state = applyOperation(state, { type: 'visit', kind: 'file', path: 'c:/fixture/ALPHA.md', at: 2 }, 'win32')
    state = applyOperation(state, { type: 'visit', kind: 'folder', path: 'C:/Fixture/Alpha.md', at: 3 }, 'win32')
    expect(state.items).toHaveLength(2)
    expect(state.items.find(item => item.kind === 'file')?.lastVisited).toBe(2)
  })
  it('retains all pins and the newest 100 unpinned locations per kind', () => {
    let state = applyOperation(createState(), { type: 'pin', kind: 'file', path: '/Fixture/pin.md', pinned: true }, 'darwin')
    for (let index = 0; index < 105; index++) {
      state = applyOperation(state, { type: 'visit', kind: 'file', path: `/Fixture/${index}.md`, at: index }, 'darwin')
    }
    state = applyOperation(state, { type: 'visit', kind: 'folder', path: '/Fixture', at: 1 }, 'darwin')
    expect(state.items).toHaveLength(102)
    expect(state.items.some(item => item.path === '/Fixture/0.md')).toBe(false)
    expect(state.items.some(item => item.path === '/Fixture/pin.md')).toBe(true)
  })
  it('searches retained recents, reports match totals, and never mutates storage order', () => {
    let state = createState()
    for (const [path, at] of [['/Fixture/beta.md', 10], ['/Fixture/alpha.md', 20], ['/Elsewhere/alpha.md', 30]] as const) {
      state = applyOperation(state, { type: 'visit', kind: 'file', path, at }, 'darwin')
    }
    state = applyOperation(state, { type: 'pin', kind: 'file', path: '/Fixture/beta.md', pinned: true }, 'darwin')
    state = applyOperation(state, { type: 'preferences', patch: { recentFiles: 1 } }, 'darwin')
    const before = JSON.stringify(state)
    const selected = selectLocations(state, { kind: 'file', query: 'ALPHA', root: '/Fixture', platform: 'darwin' })
    expect(selected.recent.map(item => item.path)).toEqual(['/Elsewhere/alpha.md', '/Fixture/alpha.md'])
    expect(selected.total).toBe(2)
    expect(JSON.stringify(state)).toBe(before)
    state = applyOperation(state, { type: 'preferences', patch: { currentFolderOnly: true } }, 'darwin')
    expect(selectLocations(state, { kind: 'file', query: 'fixture', root: '/Fixture', platform: 'darwin' }).total).toBe(2)
    expect(selectLocations(state, { kind: 'file', query: 'alpha', root: '/Fixture', platform: 'darwin' }).recent[0].path).toBe('/Fixture/alpha.md')
  })
  it('sorts pinned names independently and applies root filtering only to files', () => {
    let state = createState()
    for (const path of ['/Elsewhere/zeta', '/Fixture/Alpha']) state = applyOperation(state, { type: 'pin', kind: 'folder', path, pinned: true }, 'darwin')
    state = applyOperation(state, { type: 'preferences', patch: { currentFolderOnly: true, pinSort: { file: 'recent', folder: 'name' }, recentFiles: -8, recentFolders: 999 } }, 'darwin')
    expect(state.preferences.recentFiles).toBe(0)
    expect(state.preferences.recentFolders).toBe(100)
    expect(selectLocations(state, { kind: 'folder', query: '', root: '/Fixture', platform: 'darwin' }).pinned.map(item => item.name)).toEqual(['Alpha', 'zeta'])
  })
  it('searches all retained recents even when browsing limits hide some or all rows', () => {
    let state = createState()
    for (const [path, at] of [['/Fixture/alpha-one.md', 1], ['/Fixture/alpha-two.md', 2], ['/Fixture/beta.md', 3]] as const) {
      state = applyOperation(state, { type: 'visit', kind: 'file', path, at }, 'darwin')
    }
    for (const recentFiles of [0, 1]) {
      state = applyOperation(state, { type: 'preferences', patch: { recentFiles } }, 'darwin')
      const browsing = selectLocations(state, { kind: 'file', query: '  ', root: null, platform: 'darwin' })
      expect(browsing.recent).toHaveLength(recentFiles)
      const searching = selectLocations(state, { kind: 'file', query: 'alpha', root: null, platform: 'darwin' })
      expect(searching.total).toBe(2)
      expect(searching.recent.map(item => item.name)).toEqual(['alpha-two.md', 'alpha-one.md'])
    }
  })
  it('rejects malformed or unknown persisted data instead of replacing it', () => {
    const valid = applyOperation(createState(), { type: 'visit', kind: 'file', path: '/Fixture/alpha.md', at: 1 }, 'darwin')
    expect(validateState(JSON.parse(JSON.stringify(valid)), 'darwin')).toEqual(valid)
    for (const value of [null, {}, { ...valid, version: 2 }, { ...valid, items: [{ ...valid.items[0], lastVisited: 'yesterday' }] }, { ...valid, items: [{ ...valid.items[0], id: 'wrong' }] }, { ...valid, items: [...valid.items, ...valid.items] }, { ...valid, preferences: { ...valid.preferences, recentFiles: 101 } }, { ...valid, preferences: { ...valid.preferences, tab: ['file'] } }]) {
      expect(() => validateState(value, 'darwin')).toThrow()
    }
  })
})
