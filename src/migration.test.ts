import { describe, expect, it } from 'vitest'
import { applyOperation, createFavoritesState, createState, UNGROUPED_GROUP_ID } from './model'
import { migrateToFavorites } from './migration'

function legacyFixture() {
  let state = createState()
  state = applyOperation(state, { type: 'visit', kind: 'file', path: '/Fixture/recent-only.md', at: 30 }, 'darwin')
  state = applyOperation(state, { type: 'pin', kind: 'folder', path: '/Fixture/Folder', pinned: true }, 'darwin')
  state = applyOperation(state, { type: 'visit', kind: 'file', path: '/Fixture/pinned.md', at: 20 }, 'darwin')
  state = applyOperation(state, { type: 'pin', kind: 'file', path: '/Fixture/pinned.md', pinned: true }, 'darwin')
  return state
}

describe('Favorites state migration', () => {
  it('keeps an independent exact recovery copy including unrecognized v1 fields', () => {
    const legacy = {
      ...legacyFixture(),
      extra: { nested: ['original'], optional: undefined, created: new Date('2020-01-01T00:00:00Z') },
    }
    Object.assign(legacy.items[0], { extraItem: { retained: true } })
    const result = migrateToFavorites(legacy, 'darwin')
    if (!result.migrated) throw new Error('Expected migration')
    expect(result.recovery).toEqual(legacy)
    legacy.extra.nested.push('later mutation')
    expect((result.recovery as typeof legacy).extra.nested).toEqual(['original'])
  })

  it('moves every v1 pin exactly once to Ungrouped in retained order', () => {
    const legacy = legacyFixture()
    const result = migrateToFavorites(legacy, 'darwin')

    expect(result.migrated).toBe(true)
    if (!result.migrated) throw new Error('Expected a v1 migration result')
    expect(result.recovery).toEqual(legacy)
    expect(result.state.favorites.map(favorite => [favorite.kind, favorite.path, favorite.groupId])).toEqual([
      ['folder', '/Fixture/Folder', UNGROUPED_GROUP_ID],
      ['file', '/Fixture/pinned.md', UNGROUPED_GROUP_ID],
    ])
    expect(result.state.itemOrder[UNGROUPED_GROUP_ID]).toEqual(result.state.favorites.map(favorite => favorite.id))
    expect(result.state.favorites.some(favorite => favorite.path.endsWith('recent-only.md'))).toBe(false)
  })

  it('treats a completed v2 migration as idempotent and creates no new recovery data', () => {
    const current = createFavoritesState()
    expect(migrateToFavorites(current, 'darwin')).toEqual({ state: current, migrated: false })
  })

  it('rejects corrupt and unknown records instead of replacing them with defaults', () => {
    for (const content of [undefined, null, { broken: true }, { ...createState(), version: 99 }, { ...createState(), items: [{}] }]) {
      expect(() => migrateToFavorites(content, 'darwin')).toThrow()
    }
  })
})
