import { describe, expect, it, vi } from 'vitest'
import {
  applyFavoritesOperation,
  createFavoritesState,
  type FavoritesOperation,
  type FavoritesState,
} from './model'
import {
  createFavoritesDraft,
  FavoritesDraftSession,
  replayFavoritesDraft,
  stageFavoritesDraft,
} from './editor-state'

const apply = (state: FavoritesState, operation: FavoritesOperation) => applyFavoritesOperation(state, operation, 'darwin')

function groupedFixture() {
  let state = createFavoritesState()
  state = apply(state, { type: 'group:create', id: 'work', name: 'Work' })
  state = apply(state, { type: 'group:create', id: 'personal', name: 'Personal' })
  state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/one.md', groupId: 'work' })
  state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/two.md', groupId: 'work' })
  state = apply(state, { type: 'favorite:add', kind: 'file', path: '/Fixture/three.md', groupId: 'work' })
  return state
}

describe('Favorites stale-draft replay', () => {
  it('snapshots operation arrays and earlier draft state before staging', () => {
    const base = groupedFixture()
    const draft = createFavoritesDraft(base)
    const order = [...base.itemOrder.work].reverse()
    const staged = stageFavoritesDraft(draft, { type: 'favorite:reorder', groupId: 'work', favoriteIds: order })
    order.reverse()
    draft.base.groups[0].name = 'Mutated outside draft'
    const saved = replayFavoritesDraft(base, staged, 'darwin')
    expect(saved.itemOrder.work).toEqual([...base.itemOrder.work].reverse())
    expect(staged.base.groups[0].name).toBe('Work')
  })

  it('rejects a future base revision and divergent state sharing the same revision', () => {
    const base = groupedFixture()
    const draft = stageFavoritesDraft(createFavoritesDraft(base), { type: 'group:rename', groupId: 'work', name: 'Writing' })
    expect(() => replayFavoritesDraft({ ...base, revision: base.revision - 1 }, draft, 'darwin')).toThrow(/revision/i)
    const divergent = { ...base, groups: base.groups.map(group => group.id === 'personal' ? { ...group, name: 'Other' } : group) }
    expect(() => replayFavoritesDraft(divergent, draft, 'darwin')).toThrow(/revision/i)
  })

  it('rejects a removed target instead of treating a stale removal as a new success', () => {
    const base = groupedFixture()
    const favoriteId = base.itemOrder.work[0]
    const draft = stageFavoritesDraft(createFavoritesDraft(base), { type: 'favorite:remove', favoriteId })
    const latest = apply(base, { type: 'favorite:remove', favoriteId })
    expect(() => replayFavoritesDraft(latest, draft, 'darwin')).toThrow(/removed/i)
  })

  it('reports a moved target conflict even when another editor chose the same destination', () => {
    const base = groupedFixture()
    const operation = { type: 'favorite:move' as const, favoriteId: base.itemOrder.work[0], groupId: 'personal' }
    const draft = stageFavoritesDraft(createFavoritesDraft(base), operation)
    const latest = apply(base, operation)
    expect(() => replayFavoritesDraft(latest, draft, 'darwin')).toThrow(/moved after/i)
  })

  it('rejects a group deletion after its membership or order changes', () => {
    const base = groupedFixture()
    const draft = stageFavoritesDraft(createFavoritesDraft(base), { type: 'group:delete', groupId: 'work' })
    const latest = apply(base, { type: 'favorite:add', kind: 'file', path: '/Fixture/added.md', groupId: 'work' })
    expect(() => replayFavoritesDraft(latest, draft, 'darwin')).toThrow(/group being deleted changed/i)
  })

  it('replays two independent saves without overwriting either one', () => {
    const base = createFavoritesState()
    const first = stageFavoritesDraft(createFavoritesDraft(base), { type: 'group:create', id: 'work', name: 'Work' })
    const second = stageFavoritesDraft(createFavoritesDraft(base), { type: 'group:create', id: 'personal', name: 'Personal' })

    const afterFirst = replayFavoritesDraft(base, first, 'darwin')
    const afterSecond = replayFavoritesDraft(afterFirst, second, 'darwin')
    expect(afterSecond.groups.map(group => group.id)).toEqual(['work', 'personal'])
  })

  it('rejects a move when another save deleted its destination', () => {
    const base = groupedFixture()
    const favoriteId = base.itemOrder.work[0]
    const draft = stageFavoritesDraft(createFavoritesDraft(base), { type: 'favorite:move', favoriteId, groupId: 'personal' })
    const latest = apply(base, { type: 'group:delete', groupId: 'personal' })

    expect(() => replayFavoritesDraft(latest, draft, 'darwin')).toThrow(/destination.*deleted/i)
  })

  it('rejects simultaneous reorders of the same group', () => {
    const base = groupedFixture()
    const [one, two, three] = base.itemOrder.work
    const draft = stageFavoritesDraft(createFavoritesDraft(base), { type: 'favorite:reorder', groupId: 'work', favoriteIds: [three, two, one] })
    const latest = apply(base, { type: 'favorite:reorder', groupId: 'work', favoriteIds: [two, one, three] })

    expect(() => replayFavoritesDraft(latest, draft, 'darwin')).toThrow(/same group.*changed/i)
  })

  it('merges unrelated preference leaves from a stale draft', () => {
    const base = createFavoritesState()
    const draft = stageFavoritesDraft(createFavoritesDraft(base), { type: 'favorites:preferences', patch: { layout: 'stacked' } })
    const latest = apply(base, { type: 'favorites:preferences', patch: { activeTab: 'recent' } })

    const saved = replayFavoritesDraft(latest, draft, 'darwin')
    expect(saved.preferences.layout).toBe('stacked')
    expect(saved.preferences.activeTab).toBe('recent')
  })

  it('never resurrects a Favorite removed after the draft opened', () => {
    const base = groupedFixture()
    const removed = base.itemOrder.work[0]
    const draft = stageFavoritesDraft(createFavoritesDraft(base), {
      type: 'favorite:reorder',
      groupId: 'work',
      favoriteIds: [...base.itemOrder.work].reverse(),
    })
    const latest = apply(base, { type: 'favorite:remove', favoriteId: removed })

    expect(() => replayFavoritesDraft(latest, draft, 'darwin')).toThrow(/same group.*changed/i)
    expect(latest.favorites.some(favorite => favorite.id === removed)).toBe(false)
  })
})

describe('Favorites draft save lifecycle', () => {
  it('coalesces double Save while a write is pending', async () => {
    const session = new FavoritesDraftSession(createFavoritesState())
    session.stage({ type: 'group:create', id: 'work', name: 'Work' })
    let release!: (state: FavoritesState) => void
    const commit = vi.fn(() => new Promise<FavoritesState>(resolve => { release = resolve }))

    const first = session.save(commit)
    const second = session.save(commit)
    expect(first).toBe(second)
    expect(commit).toHaveBeenCalledOnce()
    release(apply(createFavoritesState(), { type: 'group:create', id: 'work', name: 'Work' }))
    await first
    expect(session.status).toBe('saved')
  })

  it('retains the dirty draft after a store failure and permits retry', async () => {
    const session = new FavoritesDraftSession(createFavoritesState())
    session.stage({ type: 'group:create', id: 'work', name: 'Work' })
    const failed = vi.fn(async () => { throw new Error('Synthetic full database') })

    await expect(session.save(failed)).rejects.toThrow('Synthetic full database')
    expect(session.status).toBe('editing')
    expect(session.draft.operations).toHaveLength(1)
    expect(session.error).toContain('Synthetic full database')

    const saved = await session.save(async draft => replayFavoritesDraft(createFavoritesState(), draft, 'darwin'))
    expect(saved.groups.map(group => group.id)).toEqual(['work'])
    expect(session.status).toBe('saved')
  })
})
