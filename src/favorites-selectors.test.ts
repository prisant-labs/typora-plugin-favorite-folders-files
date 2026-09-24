import { describe, expect, it } from 'vitest'
import * as modelModule from './model'

type FavoritesSelectorsApi = {
  UNGROUPED_GROUP_ID: string
  createFavoritesState(): any
  applyFavoritesOperation(state: any, operation: any, platform: 'win32' | 'darwin' | 'linux'): any
  selectFavoriteGroups(state: any, activity?: any): { groups: any[]; recentSupported: boolean }
  selectFavoritesInGroup(state: any, groupId: string, activity?: any): { favorites: any[]; recentSupported: boolean }
}

const model = modelModule as unknown as FavoritesSelectorsApi

function fixture() {
  let state = model.createFavoritesState()
  for (const [id, name] of [['projects', 'Projects 10'], ['writing', 'Writing'], ['projects-2', 'Projects 2']] as const) {
    state = model.applyFavoritesOperation(state, { type: 'group:create', id, name }, 'darwin')
  }
  for (const [kind, path, groupId] of [
    ['file', '/Fixture/zeta.md', 'projects'],
    ['folder', '/Fixture/Alpha 10', 'projects'],
    ['file', '/Fixture/alpha 2.md', 'projects'],
    ['file', '/Fixture/notes.md', 'writing'],
  ] as const) state = model.applyFavoritesOperation(state, { type: 'favorite:add', kind, path, groupId }, 'darwin')
  return state
}

describe('Favorites group and item selectors', () => {
  it('uses Custom groups and numeric-aware A-Z items by default while keeping Ungrouped last', () => {
    const state = fixture()
    const groups = model.selectFavoriteGroups(state)
    expect(groups.groups.map(group => group.id)).toEqual(['projects', 'writing', 'projects-2', model.UNGROUPED_GROUP_ID])
    expect(model.selectFavoritesInGroup(state, 'projects').favorites.map(favorite => favorite.path)).toEqual([
      '/Fixture/alpha 2.md', '/Fixture/Alpha 10', '/Fixture/zeta.md',
    ])
  })

  it('retains Custom sequences while automatic sorts are active and restores them unchanged', () => {
    let state = fixture()
    const retainedGroups = ['projects-2', 'projects', 'writing']
    const retainedItems = [...state.itemOrder.projects].reverse()
    state = model.applyFavoritesOperation(state, { type: 'group:reorder', groupIds: retainedGroups }, 'darwin')
    state = model.applyFavoritesOperation(state, { type: 'favorite:reorder', groupId: 'projects', favoriteIds: retainedItems }, 'darwin')
    const before = JSON.stringify({ groupOrder: state.groupOrder, itemOrder: state.itemOrder })
    state = model.applyFavoritesOperation(state, { type: 'favorites:preferences', patch: { groupSort: 'az', itemSort: 'az' } }, 'darwin')
    expect(model.selectFavoriteGroups(state).groups.map(group => group.id)).toEqual(['projects-2', 'projects', 'writing', model.UNGROUPED_GROUP_ID])
    state = model.applyFavoritesOperation(state, { type: 'favorites:preferences', patch: { groupSort: 'custom', itemSort: 'custom' } }, 'darwin')
    expect(model.selectFavoriteGroups(state).groups.map(group => group.id)).toEqual([...retainedGroups, model.UNGROUPED_GROUP_ID])
    expect(model.selectFavoritesInGroup(state, 'projects').favorites.map(favorite => favorite.id)).toEqual(retainedItems)
    expect(JSON.stringify({ groupOrder: state.groupOrder, itemOrder: state.itemOrder })).toBe(before)
  })

  it('sorts items and groups by trustworthy timestamps with retained Custom ties', () => {
    let state = fixture()
    state = model.applyFavoritesOperation(state, { type: 'favorites:preferences', patch: { groupSort: 'recent', itemSort: 'recent' } }, 'darwin')
    const [zeta, alpha10, alpha2, writing] = [
      state.itemOrder.projects[0], state.itemOrder.projects[1], state.itemOrder.projects[2], state.itemOrder.writing[0],
    ]
    const activity = { kind: 'timestamps', openedAt: { [zeta]: 20, [alpha10]: 30, [alpha2]: 30, [writing]: 40 } }
    const selected = model.selectFavoritesInGroup(state, 'projects', activity)
    expect(selected.recentSupported).toBe(true)
    expect(selected.favorites.map(favorite => favorite.id)).toEqual([alpha10, alpha2, zeta])
    expect(model.selectFavoriteGroups(state, activity).groups.map(group => group.id)).toEqual(['writing', 'projects', 'projects-2', model.UNGROUPED_GROUP_ID])
  })

  it('supports a common native order but rejects cross-kind per-kind ranks', () => {
    let state = fixture()
    state = model.applyFavoritesOperation(state, { type: 'favorites:preferences', patch: { groupSort: 'recent', itemSort: 'recent' } }, 'darwin')
    const projectIds = state.itemOrder.projects
    const global = model.selectFavoritesInGroup(state, 'projects', { kind: 'global-order', favoriteIds: [projectIds[2], projectIds[0], projectIds[1]] })
    expect(global.recentSupported).toBe(true)
    expect(global.favorites.map(favorite => favorite.id)).toEqual([projectIds[2], projectIds[0], projectIds[1]])
    const perKind = { kind: 'per-kind-order', fileIds: [projectIds[2], projectIds[0]], folderIds: [projectIds[1]] }
    const unsupported = model.selectFavoritesInGroup(state, 'projects', perKind)
    expect(unsupported.recentSupported).toBe(false)
    expect(unsupported.favorites.map(favorite => favorite.id)).toEqual(projectIds)
    expect(model.selectFavoriteGroups(state, perKind).recentSupported).toBe(false)
  })

  it('keeps never-opened items after known activity without inventing activity', () => {
    let state = fixture()
    state = model.applyFavoritesOperation(state, { type: 'favorites:preferences', patch: { itemSort: 'recent' } }, 'darwin')
    const projectIds = state.itemOrder.projects
    const selected = model.selectFavoritesInGroup(state, 'projects', { kind: 'timestamps', openedAt: { [projectIds[1]]: 5 } })
    expect(selected.recentSupported).toBe(true)
    expect(selected.favorites.map(favorite => favorite.id)).toEqual([projectIds[1], projectIds[0], projectIds[2]])
  })

  it('reports unavailable recency explicitly instead of fabricating an order', () => {
    let state = fixture()
    state = model.applyFavoritesOperation(state, { type: 'favorites:preferences', patch: { groupSort: 'recent', itemSort: 'recent' } }, 'darwin')
    const groupResult = model.selectFavoriteGroups(state, { kind: 'unavailable' })
    const itemResult = model.selectFavoritesInGroup(state, 'projects', { kind: 'unavailable' })
    expect(groupResult.recentSupported).toBe(false)
    expect(itemResult.recentSupported).toBe(false)
    expect(groupResult.groups.map(group => group.id)).toEqual([...state.groupOrder, model.UNGROUPED_GROUP_ID])
    expect(itemResult.favorites.map(favorite => favorite.id)).toEqual(state.itemOrder.projects)
  })
})
