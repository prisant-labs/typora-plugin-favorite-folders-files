import { describe, expect, it } from 'vitest'
import * as modelModule from './model'

type FavoritesModelApi = {
  ALL_GROUPS_ID: string
  UNGROUPED_GROUP_ID: string
  createFavoritesState(): any
  applyFavoritesOperation(state: any, operation: any, platform: 'win32' | 'darwin' | 'linux'): any
  validateFavoritesState(value: unknown, platform?: 'win32' | 'darwin' | 'linux'): any
}

const model = modelModule as unknown as FavoritesModelApi

function apply(state: any, operation: any, platform: 'win32' | 'darwin' | 'linux' = 'darwin') {
  return model.applyFavoritesOperation(state, operation, platform)
}

describe('Favorites v2 collection model', () => {
  it('rejects unsafe revision counters and refuses revision overflow', () => {
    expect(() => model.validateFavoritesState({ ...model.createFavoritesState(), revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/revision/i)
    expect(() => apply({ ...model.createFavoritesState(), revision: Number.MAX_SAFE_INTEGER }, { type: 'group:create', id: 'work', name: 'Work' })).toThrow(/revision/i)
  })

  it('rejects prototype-sensitive group identities before changing order maps', () => {
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      expect(() => apply(model.createFavoritesState(), { type: 'group:create', id, name: 'Work' })).toThrow(/group identity/i)
    }
  })

  it('returns an independent snapshot even when an operation changes nothing', () => {
    const state = apply(model.createFavoritesState(), { type: 'favorite:add', kind: 'file', path: '/Fixture/one.md', groupId: model.UNGROUPED_GROUP_ID })
    const unchanged = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/one.md', groupId: model.UNGROUPED_GROUP_ID })
    unchanged.favorites[0].path = '/Fixture/changed.md'
    expect(state.favorites[0].path).toBe('/Fixture/one.md')
    expect(unchanged.revision).toBe(state.revision)
  })

  it('rejects unknown preference leaves instead of preserving aliased unvalidated data', () => {
    const state = model.createFavoritesState()
    expect(() => model.validateFavoritesState({ ...state, preferences: { ...state.preferences, future: { nested: true } } })).toThrow(/preferences/i)
    expect(() => model.validateFavoritesState({ ...state, preferences: Object.create(state.preferences) })).toThrow(/preferences/i)
  })

  it('creates the frozen defaults with implicit protected Ungrouped', () => {
    expect(typeof model.createFavoritesState).toBe('function')
    expect(model.createFavoritesState()).toEqual({
      version: 2,
      revision: 0,
      favorites: [],
      groups: [],
      groupOrder: [],
      itemOrder: { [model.UNGROUPED_GROUP_ID]: [] },
      preferences: {
        layout: 'tabs',
        groupView: 'outline',
        activeTab: 'favorites',
        recentFilter: 'file',
        groupSort: 'custom',
        itemSort: 'az',
        collapsedGroups: [],
        selectedGroup: model.ALL_GROUPS_ID,
        favoritesCollapsed: false,
        recentCollapsed: false,
      },
    })
  })

  it('keeps canonical Favorite identity unique and changes membership only through Move', () => {
    let state = model.createFavoritesState()
    state = apply(state, { type: 'group:create', id: 'projects', name: 'Projects' }, 'win32')
    state = apply(state, { type: 'favorite:add', kind: 'file', path: 'C:\\Fixture\\Alpha.md', groupId: model.UNGROUPED_GROUP_ID }, 'win32')
    const once = apply(state, { type: 'favorite:add', kind: 'file', path: 'c:/fixture/ALPHA.md', groupId: 'projects' }, 'win32')
    expect(once.favorites).toHaveLength(1)
    expect(once.favorites[0].groupId).toBe(model.UNGROUPED_GROUP_ID)
    const moved = apply(once, { type: 'favorite:move', favoriteId: once.favorites[0].id, groupId: 'projects' }, 'win32')
    expect(moved.favorites).toHaveLength(1)
    expect(moved.favorites[0].groupId).toBe('projects')
    expect(moved.itemOrder).toEqual({ [model.UNGROUPED_GROUP_ID]: [], projects: [moved.favorites[0].id] })
  })

  it('allows one named group to contain mixed folder and file Favorites', () => {
    let state = apply(model.createFavoritesState(), { type: 'group:create', id: 'writing', name: 'Writing' })
    state = apply(state, { type: 'favorite:add', kind: 'folder', path: '/Fixture/Writing', groupId: 'writing' })
    state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/Writing/Brief.md', groupId: 'writing' })
    expect(state.favorites.map((favorite: any) => favorite.kind)).toEqual(['folder', 'file'])
    expect(state.favorites.every((favorite: any) => favorite.groupId === 'writing')).toBe(true)
  })

  it('trims group names and rejects blank, reserved, or case-insensitive duplicates', () => {
    let state = apply(model.createFavoritesState(), { type: 'group:create', id: 'projects', name: '  Projects  ' })
    expect(state.groups).toEqual([{ id: 'projects', name: 'Projects' }])
    expect(() => apply(state, { type: 'group:create', id: 'other', name: 'projects' })).toThrow(/group name/i)
    expect(() => apply(state, { type: 'group:create', id: 'blank', name: '   ' })).toThrow(/group name/i)
    expect(() => apply(state, { type: 'group:create', id: 'reserved', name: 'Ungrouped' })).toThrow(/group name/i)
    expect(() => apply(state, { type: 'group:rename', groupId: model.UNGROUPED_GROUP_ID, name: 'Other' })).toThrow(/Ungrouped/i)
    expect(() => apply(state, { type: 'group:delete', groupId: model.UNGROUPED_GROUP_ID })).toThrow(/Ungrouped/i)
  })

  it('enforces the frozen 60-character group-name limit and rejects control characters', () => {
    const state = model.createFavoritesState()
    expect(apply(state, { type: 'group:create', id: 'work', name: 'x'.repeat(60) }).groups[0].name).toHaveLength(60)
    expect(() => apply(state, { type: 'group:create', id: 'work', name: 'x'.repeat(61) })).toThrow(/group name/i)
    expect(() => apply(state, { type: 'group:create', id: 'work', name: 'Work\nArchive' })).toThrow(/group name/i)
    expect(() => apply(state, { type: 'group:create', id: 'work', name: 'Work\u0000' })).toThrow(/group name/i)
  })

  it('deletes a group by transferring members to Ungrouped in retained custom order', () => {
    let state = apply(model.createFavoritesState(), { type: 'group:create', id: 'projects', name: 'Projects' })
    state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/unfiled.md', groupId: model.UNGROUPED_GROUP_ID })
    state = apply(state, { type: 'favorite:add', kind: 'folder', path: '/Fixture/Beta', groupId: 'projects' })
    state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/Alpha.md', groupId: 'projects' })
    const projectOrder = [...state.itemOrder.projects]
    const deleted = apply(state, { type: 'group:delete', groupId: 'projects' })
    expect(deleted.groups).toEqual([])
    expect(deleted.groupOrder).toEqual([])
    expect(deleted.favorites.every((favorite: any) => favorite.groupId === model.UNGROUPED_GROUP_ID)).toBe(true)
    expect(deleted.itemOrder[model.UNGROUPED_GROUP_ID]).toEqual([state.itemOrder[model.UNGROUPED_GROUP_ID][0], ...projectOrder])
    expect(deleted.itemOrder.projects).toBeUndefined()
  })

  it('keeps group and per-group custom sequences independent, including empty groups', () => {
    let state = model.createFavoritesState()
    state = apply(state, { type: 'group:create', id: 'projects', name: 'Projects' })
    state = apply(state, { type: 'group:create', id: 'writing', name: 'Writing' })
    state = apply(state, { type: 'group:create', id: 'empty', name: 'Empty' })
    state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/one.md', groupId: 'projects' })
    state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/two.md', groupId: 'projects' })
    state = apply(state, { type: 'favorite:add', kind: 'folder', path: '/Fixture/Notes', groupId: 'writing' })
    const writingOrder = [...state.itemOrder.writing]
    state = apply(state, { type: 'group:reorder', groupIds: ['writing', 'empty', 'projects'] })
    state = apply(state, { type: 'favorite:reorder', groupId: 'projects', favoriteIds: [...state.itemOrder.projects].reverse() })
    expect(state.groupOrder).toEqual(['writing', 'empty', 'projects'])
    expect(state.itemOrder.writing).toEqual(writingOrder)
    expect(state.itemOrder.empty).toEqual([])
  })

  it('rejects foreign IDs, duplicate order entries, invalid sorts, and malformed persisted state', () => {
    let state = apply(model.createFavoritesState(), { type: 'group:create', id: 'projects', name: 'Projects' })
    state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/one.md', groupId: 'projects' })
    expect(() => apply(state, { type: 'group:reorder', groupIds: ['projects', 'foreign'] })).toThrow(/group order/i)
    expect(() => apply(state, { type: 'favorite:reorder', groupId: 'projects', favoriteIds: ['foreign'] })).toThrow(/item order/i)
    expect(() => apply(state, { type: 'favorites:preferences', patch: { itemSort: 'newest-ish' } })).toThrow(/preferences/i)
    expect(() => model.validateFavoritesState({ ...state, itemOrder: { ...state.itemOrder, projects: [state.favorites[0].id, state.favorites[0].id] } }, 'darwin')).toThrow(/item order/i)
    expect(model.validateFavoritesState(JSON.parse(JSON.stringify(state)), 'darwin')).toEqual(state)
  })
})
