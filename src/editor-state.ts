import {
  applyFavoritesOperation,
  locationId,
  normalizePath,
  validateFavoritesState,
  type FavoritesOperation,
  type FavoritesPreferences,
  type FavoritesState,
  type Platform,
} from './model'

export interface FavoritesDraft {
  base: FavoritesState
  operations: FavoritesOperation[]
}

export function createFavoritesDraft(base: FavoritesState): FavoritesDraft {
  return { base: validateFavoritesState(base), operations: [] }
}

export function projectFavoritesDraft(draft: FavoritesDraft, platform: Platform = 'darwin'): FavoritesState {
  return draft.operations.reduce((state, operation) => applyFavoritesOperation(state, operation, platform), validateFavoritesState(draft.base, platform))
}

export function cloneFavoritesOperation(operation: FavoritesOperation): FavoritesOperation {
  if (operation.type === 'group:reorder') return { ...operation, groupIds: [...operation.groupIds] }
  if (operation.type === 'favorite:reorder') return { ...operation, favoriteIds: [...operation.favoriteIds] }
  if (operation.type === 'favorites:preferences') return {
    ...operation,
    patch: { ...operation.patch, ...(operation.patch.collapsedGroups ? { collapsedGroups: [...operation.patch.collapsedGroups] } : {}) },
  }
  return { ...operation }
}

export function cloneFavoritesDraft(draft: FavoritesDraft): FavoritesDraft {
  return { base: validateFavoritesState(draft.base), operations: draft.operations.map(cloneFavoritesOperation) }
}

export function stageFavoritesDraft(draft: FavoritesDraft, operation: FavoritesOperation, platform: Platform = 'darwin'): FavoritesDraft {
  // Validate the proposed operation against the editor's own projected state.
  applyFavoritesOperation(projectFavoritesDraft(draft, platform), operation, platform)
  const copy = cloneFavoritesDraft(draft)
  return { base: copy.base, operations: [...copy.operations, cloneFavoritesOperation(operation)] }
}

const equalOrder = (first: string[], second: string[]) => first.length === second.length && first.every((id, index) => id === second[index])
const findFavorite = (state: FavoritesState, id: string) => state.favorites.find(favorite => favorite.id === id)
const hasGroup = (state: FavoritesState, id: string) => id === '__ungrouped__' || state.groups.some(group => group.id === id)

function conflict(message: string): never {
  throw new Error(`Favorites draft conflict: ${message}. Review the latest saved changes and try again.`)
}

/**
 * Check only the domain leaves an operation owns. This allows independent
 * stale edits to replay while rejecting changes that could overwrite work in
 * the same group, Favorite, or preference leaf.
 */
function operationCanReplay(expected: FavoritesState, current: FavoritesState, operation: FavoritesOperation, platform: Platform): 'apply' | 'skip' {
  if (operation.type === 'group:create') {
    const existing = current.groups.find(group => group.id === operation.id)
    if (existing) conflict('a group with this identity was added after the editor opened')
  } else if (operation.type === 'group:rename') {
    const before = expected.groups.find(group => group.id === operation.groupId)
    const now = current.groups.find(group => group.id === operation.groupId)
    if (!before || !now) conflict('the group being renamed was deleted')
    if (before.name !== now.name && now.name !== operation.name.trim()) conflict('the group name changed after the editor opened')
    if (now.name === operation.name.trim()) return 'skip'
  } else if (operation.type === 'group:delete') {
    const before = expected.groups.find(group => group.id === operation.groupId)
    const now = current.groups.find(group => group.id === operation.groupId)
    if (!before || !now) conflict('the group being deleted was already deleted')
    if (before.name !== now.name || !equalOrder(expected.itemOrder[operation.groupId], current.itemOrder[operation.groupId])) {
      conflict('the group being deleted changed after the editor opened')
    }
  } else if (operation.type === 'group:reorder') {
    if (!equalOrder(expected.groupOrder, current.groupOrder)) conflict('the group order changed after the editor opened')
  } else if (operation.type === 'favorite:add') {
    if (!hasGroup(current, operation.groupId)) conflict('the destination group was deleted')
    const path = normalizePath(operation.path, platform)
    const id = locationId(operation.kind, path, platform)
    const existing = findFavorite(current, id)
    if (existing) {
      if (existing.groupId === operation.groupId) return 'skip'
      conflict('the Favorite was added to a different group')
    }
  } else if (operation.type === 'favorite:move') {
    if (!hasGroup(current, operation.groupId)) conflict('the destination group was deleted')
    const before = findFavorite(expected, operation.favoriteId)
    const now = findFavorite(current, operation.favoriteId)
    if (!before || !now) conflict('the Favorite being moved was removed')
    if (before.groupId !== now.groupId) conflict('the Favorite moved after the editor opened')
    if (now.groupId === operation.groupId) return 'skip'
  } else if (operation.type === 'favorite:remove') {
    const before = findFavorite(expected, operation.favoriteId)
    const now = findFavorite(current, operation.favoriteId)
    if (!now) conflict('the Favorite being removed was already removed')
    if (!before || before.groupId !== now.groupId) conflict('the Favorite changed after the editor opened')
  } else if (operation.type === 'favorite:reorder') {
    if (!hasGroup(current, operation.groupId)) conflict('the group being arranged was deleted')
    if (!equalOrder(expected.itemOrder[operation.groupId], current.itemOrder[operation.groupId])) conflict('the same group changed after the editor opened')
  } else if (operation.type === 'favorites:preferences') {
    for (const key of Object.keys(operation.patch) as (keyof FavoritesPreferences)[]) {
      const before = expected.preferences[key]
      const now = current.preferences[key]
      const desired = operation.patch[key]
      const same = Array.isArray(before) && Array.isArray(now) ? equalOrder(before, now) : before === now
      const alreadyApplied = Array.isArray(now) && Array.isArray(desired) ? equalOrder(now, desired) : now === desired
      if (!same && !alreadyApplied) conflict(`the ${key} preference changed after the editor opened`)
    }
  }
  return 'apply'
}

export function replayFavoritesDraft(latest: FavoritesState, draft: FavoritesDraft, platform: Platform): FavoritesState {
  let expected = validateFavoritesState(draft.base, platform)
  let current = validateFavoritesState(latest, platform)
  if (expected.revision > current.revision || (expected.revision === current.revision && JSON.stringify(expected) !== JSON.stringify(current))) {
    conflict('the saved revision does not match the draft base')
  }
  for (const operation of draft.operations) {
    const decision = operationCanReplay(expected, current, operation, platform)
    expected = applyFavoritesOperation(expected, operation, platform)
    if (decision === 'apply') current = applyFavoritesOperation(current, operation, platform)
  }
  return current
}

export type FavoritesDraftStatus = 'editing' | 'saving' | 'saved'

export class FavoritesDraftSession {
  draft: FavoritesDraft
  status: FavoritesDraftStatus = 'editing'
  error?: string
  private pending?: Promise<FavoritesState>

  constructor(base: FavoritesState, private readonly platform: Platform = 'darwin') {
    this.draft = createFavoritesDraft(base)
  }

  stage(operation: FavoritesOperation): void {
    if (this.status !== 'editing') throw new Error('The Favorites draft cannot be changed while it is saving or after it is saved')
    this.draft = stageFavoritesDraft(this.draft, operation, this.platform)
    this.error = undefined
  }

  save(commit: (draft: FavoritesDraft) => Promise<FavoritesState>): Promise<FavoritesState> {
    if (this.pending) return this.pending
    if (this.status === 'saved') return Promise.reject(new Error('The Favorites draft was already saved'))
    this.status = 'saving'
    this.error = undefined
    let committed: Promise<FavoritesState>
    try {
      committed = commit(this.draft)
    } catch (error) {
      committed = Promise.reject(error)
    }
    this.pending = committed.then(state => {
      this.status = 'saved'
      this.pending = undefined
      return state
    }, error => {
      this.status = 'editing'
      this.error = error instanceof Error ? error.message : 'Favorites could not be saved'
      this.pending = undefined
      throw error
    })
    return this.pending
  }
}
