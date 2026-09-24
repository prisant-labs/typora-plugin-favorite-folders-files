/** Shared by the native plugin and the self-contained visual anchor. No Node APIs. */
export type LocationKind = 'file' | 'folder'
export type Platform = 'win32' | 'darwin' | 'linux'
export type PinSort = 'recent' | 'name'
export interface Location {
  id: string
  kind: LocationKind
  path: string
  name: string
  pinned: boolean
  lastVisited: number | null
}
export interface Preferences {
  tab: LocationKind
  pinSort: Record<LocationKind, PinSort>
  collapsed: Record<LocationKind, { pinned: boolean; recent: boolean }>
  currentFolderOnly: boolean
  recentFiles: number
  recentFolders: number
}
export type PreferencesPatch = Partial<Omit<Preferences, 'pinSort' | 'collapsed'>> & {
  pinSort?: Partial<Record<LocationKind, PinSort>>
  collapsed?: Partial<Record<LocationKind, Partial<{ pinned: boolean; recent: boolean }>>>
}
export interface State {
  version: 1
  items: Location[]
  preferences: Preferences
}
export type Operation =
  | { type: 'pin'; kind: LocationKind; path: string; pinned: boolean }
  | { type: 'visit'; kind: LocationKind; path: string; at: number }
  | { type: 'preferences'; patch: PreferencesPatch }

export function createState(): State {
  return {
    version: 1,
    items: [],
    preferences: {
      tab: 'folder',
      pinSort: { file: 'recent', folder: 'recent' },
      collapsed: { file: { pinned: false, recent: false }, folder: { pinned: false, recent: false } },
      currentFolderOnly: false,
      recentFiles: 20,
      recentFolders: 10,
    },
  }
}

export function normalizePath(path: string, platform: Platform): string {
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error('Unsupported path platform')
  if (typeof path !== 'string' || !path || /[\u0000-\u001f\u007f]/.test(path)) throw new Error('Invalid absolute path')
  let root: string
  let remainder: string
  if (platform === 'win32') {
    const slashes = path.replace(/\\/g, '/')
    const drive = /^([a-zA-Z]:)\//.exec(slashes)
    if (drive) {
      root = `${drive[1]}/`
      remainder = slashes.slice(root.length)
    } else {
      const unc = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/.exec(slashes)
      if (!unc || ['.', '..', '?'].includes(unc[1]) || ['.', '..'].includes(unc[2])) throw new Error('Expected an absolute drive or UNC path')
      root = `//${unc[1]}/${unc[2]}`
      remainder = slashes.slice(unc[0].length)
    }
  } else {
    if (!path.startsWith('/')) throw new Error('Expected an absolute path')
    root = '/'
    remainder = path.slice(1)
  }
  const segments: string[] = []
  for (const segment of remainder.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.length ? `${root}${root.endsWith('/') ? '' : '/'}${segments.join('/')}` : root
}

function identityPath(path: string, platform: Platform): string {
  const normalized = normalizePath(path, platform)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function locationId(kind: LocationKind, path: string, platform: Platform): string {
  if (kind !== 'file' && kind !== 'folder') throw new Error('Invalid location kind')
  return `${kind}:${identityPath(path, platform)}`
}

export function isWithin(path: string, root: string, platform: Platform): boolean {
  const child = identityPath(path, platform)
  const parent = identityPath(root, platform)
  return child === parent || child.startsWith(`${parent}${parent.endsWith('/') ? '' : '/'}`)
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path
}

function byName(first: Location, second: Location): number {
  return first.name.toLowerCase().localeCompare(second.name.toLowerCase()) || first.path.localeCompare(second.path)
}

function byRecent(first: Location, second: Location): number {
  return (second.lastVisited ?? -1) - (first.lastVisited ?? -1) || byName(first, second)
}

function retain(items: Location[]): Location[] {
  const retained = new Set(items.filter(item => item.pinned).map(item => item.id))
  for (const kind of ['file', 'folder'] as const) {
    items.filter(item => item.kind === kind && !item.pinned).sort(byRecent).slice(0, 100).forEach(item => retained.add(item.id))
  }
  return items.filter(item => retained.has(item.id))
}

function clampCount(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Recent limits must be finite numbers')
  return Math.max(0, Math.min(100, Math.floor(value)))
}

export function applyOperation(state: State, op: Operation, platform: Platform): State {
  if (op.type === 'preferences') {
    const preferences = {
      ...state.preferences,
      ...op.patch,
      pinSort: { ...state.preferences.pinSort, ...op.patch.pinSort },
      collapsed: {
        file: { ...state.preferences.collapsed.file, ...op.patch.collapsed?.file },
        folder: { ...state.preferences.collapsed.folder, ...op.patch.collapsed?.folder },
      },
    }
    preferences.recentFiles = clampCount(preferences.recentFiles)
    preferences.recentFolders = clampCount(preferences.recentFolders)
    validatePreferences(preferences)
    return { ...state, preferences: clonePreferences(preferences) }
  }
  if (op.type !== 'pin' && op.type !== 'visit') throw new Error('Unknown location operation')
  if (op.type === 'pin' && typeof op.pinned !== 'boolean') throw new Error('Invalid pin value')
  if (op.type === 'visit' && (typeof op.at !== 'number' || !Number.isFinite(op.at) || op.at < 0)) throw new Error('Invalid visit time')
  const path = normalizePath(op.path, platform)
  const id = locationId(op.kind, path, platform)
  const existing = state.items.find(item => item.id === id)
  if (!existing && op.type === 'pin' && !op.pinned) return state
  const item: Location = existing ? { ...existing } : { id, kind: op.kind, path, name: nameOf(path), pinned: false, lastVisited: null }
  if (op.type === 'pin') item.pinned = op.pinned
  else {
    item.path = path
    item.name = nameOf(path)
    // A delayed notification must not make a newer visit look older.
    item.lastVisited = Math.max(item.lastVisited ?? 0, op.at)
  }
  return { ...state, items: retain(existing ? state.items.map(candidate => candidate.id === id ? item : candidate) : [...state.items, item]) }
}

export function selectLocations(state: State, options: { kind: LocationKind; query: string; root: string | null; platform: Platform }): { pinned: Location[]; recent: Location[]; total: number } {
  const query = options.query.trim().toLowerCase()
  const items = state.items.filter(item => {
    if (item.kind !== options.kind || (!item.pinned && item.lastVisited === null)) return false
    if (options.kind === 'file' && state.preferences.currentFolderOnly && (!options.root || !isWithin(item.path, options.root, options.platform))) return false
    return !query || item.name.toLowerCase().includes(query) || item.path.toLowerCase().includes(query)
  })
  const pinned = items.filter(item => item.pinned).sort(state.preferences.pinSort[options.kind] === 'name' ? byName : byRecent)
  // Display limits keep browsing compact; search must reveal every retained match.
  const limit = query ? 100 : options.kind === 'file' ? state.preferences.recentFiles : state.preferences.recentFolders
  const recent = items.filter(item => !item.pinned).sort(byRecent).slice(0, limit)
  return { pinned, recent, total: items.length }
}

function object(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${description}`)
  return value as Record<string, unknown>
}

function validatePreferences(value: unknown): asserts value is Preferences {
  const preferences = object(value, 'preferences')
  if ((preferences.tab !== 'file' && preferences.tab !== 'folder') || typeof preferences.currentFolderOnly !== 'boolean') throw new Error('Invalid preferences')
  for (const key of ['recentFiles', 'recentFolders']) {
    const count = preferences[key]
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 100) throw new Error('Invalid recent limit')
  }
  const sorts = object(preferences.pinSort, 'pin sort')
  const collapsed = object(preferences.collapsed, 'collapsed sections')
  for (const kind of ['file', 'folder']) {
    if (sorts[kind] !== 'recent' && sorts[kind] !== 'name') throw new Error('Invalid pinned sort')
    const sections = object(collapsed[kind], 'collapsed section')
    if (typeof sections.pinned !== 'boolean' || typeof sections.recent !== 'boolean') throw new Error('Invalid collapsed section')
  }
}

function clonePreferences(value: Preferences): Preferences {
  return { tab: value.tab, pinSort: { ...value.pinSort }, collapsed: { file: { ...value.collapsed.file }, folder: { ...value.collapsed.folder } }, currentFolderOnly: value.currentFolderOnly, recentFiles: value.recentFiles, recentFolders: value.recentFolders }
}

/** Fail closed: invalid persisted data must never be treated as an empty store. */
export function validateState(value: unknown, platform?: Platform): State {
  const state = object(value, 'saved state')
  if (state.version !== 1) throw new Error('Unsupported saved state version')
  if (!Array.isArray(state.items)) throw new Error('Invalid saved locations')
  validatePreferences(state.preferences)
  const ids = new Set<string>()
  const items = state.items.map(raw => {
    const item = object(raw, 'saved location')
    if ((item.kind !== 'file' && item.kind !== 'folder') || typeof item.path !== 'string' || typeof item.name !== 'string' || typeof item.id !== 'string' || typeof item.pinned !== 'boolean' || (item.lastVisited !== null && (typeof item.lastVisited !== 'number' || !Number.isFinite(item.lastVisited) || item.lastVisited < 0))) throw new Error('Invalid saved location')
    const pathPlatform = platform ?? (/^[a-zA-Z]:[\\/]|^[/\\]{2}/.test(item.path) ? 'win32' : 'darwin')
    const path = normalizePath(item.path, pathPlatform)
    if (path !== item.path || item.id !== locationId(item.kind, path, pathPlatform) || item.name !== nameOf(path) || ids.has(item.id)) throw new Error('Invalid or duplicate location identity')
    ids.add(item.id)
    return { id: item.id, kind: item.kind, path, name: item.name, pinned: item.pinned, lastVisited: item.lastVisited } as Location
  })
  return { version: 1, items, preferences: clonePreferences(state.preferences) }
}

// Favorites v2 is introduced alongside the still-running v1 candidate so the
// model and migration can be proven before the production panel cuts over.
export const ALL_GROUPS_ID = '__all__'
export const UNGROUPED_GROUP_ID = '__ungrouped__'
export const MAX_GROUP_NAME_LENGTH = 60

export type FavoritesSortMode = 'custom' | 'az' | 'recent'
export interface Favorite {
  id: string
  kind: LocationKind
  path: string
  groupId: string
}
export interface FavoriteGroup {
  id: string
  name: string
}
export interface FavoritesPreferences {
  layout: 'tabs' | 'stacked'
  groupView: 'outline' | 'filter'
  activeTab: 'favorites' | 'recent'
  recentFilter: 'all' | LocationKind
  groupSort: FavoritesSortMode
  itemSort: FavoritesSortMode
  collapsedGroups: string[]
  selectedGroup: string
  favoritesCollapsed: boolean
  recentCollapsed: boolean
}
export interface FavoritesState {
  version: 2
  revision: number
  favorites: Favorite[]
  groups: FavoriteGroup[]
  groupOrder: string[]
  itemOrder: Record<string, string[]>
  preferences: FavoritesPreferences
}
export type FavoriteActivitySnapshot =
  | { kind: 'unavailable' }
  | { kind: 'timestamps'; openedAt: Record<string, number> }
  | { kind: 'global-order'; favoriteIds: string[] }
  | { kind: 'per-kind-order'; fileIds: string[]; folderIds: string[] }
export type FavoritesOperation =
  | { type: 'group:create'; id: string; name: string }
  | { type: 'group:rename'; groupId: string; name: string }
  | { type: 'group:delete'; groupId: string }
  | { type: 'group:reorder'; groupIds: string[] }
  | { type: 'favorite:add'; kind: LocationKind; path: string; groupId: string }
  | { type: 'favorite:move'; favoriteId: string; groupId: string }
  | { type: 'favorite:remove'; favoriteId: string }
  | { type: 'favorite:reorder'; groupId: string; favoriteIds: string[] }
  | { type: 'favorites:preferences'; patch: Partial<FavoritesPreferences> }

export function createFavoritesState(): FavoritesState {
  return {
    version: 2,
    revision: 0,
    favorites: [],
    groups: [],
    groupOrder: [],
    itemOrder: { [UNGROUPED_GROUP_ID]: [] },
    preferences: {
      layout: 'tabs',
      groupView: 'outline',
      activeTab: 'favorites',
      recentFilter: 'file',
      groupSort: 'custom',
      itemSort: 'az',
      collapsedGroups: [],
      selectedGroup: ALL_GROUPS_ID,
      favoritesCollapsed: false,
      recentCollapsed: false,
    },
  }
}

function cloneFavoritesState(state: FavoritesState): FavoritesState {
  return {
    version: 2,
    revision: state.revision,
    favorites: state.favorites.map(favorite => ({ ...favorite })),
    groups: state.groups.map(group => ({ ...group })),
    groupOrder: [...state.groupOrder],
    itemOrder: Object.fromEntries(Object.entries(state.itemOrder).map(([id, order]) => [id, [...order]])),
    preferences: { ...state.preferences, collapsedGroups: [...state.preferences.collapsedGroups] },
  }
}

function validGroupId(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && ![ALL_GROUPS_ID, UNGROUPED_GROUP_ID, '__proto__', 'constructor', 'prototype'].includes(value) && !/[\u0000-\u001f\u007f]/.test(value)
}

function normalizeGroupName(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid group name')
  const name = value.trim()
  if (!name || name.length > MAX_GROUP_NAME_LENGTH || name.toLocaleLowerCase() === 'ungrouped') throw new Error('Invalid group name')
  return name
}

function groupExists(state: FavoritesState, groupId: string): boolean {
  return groupId === UNGROUPED_GROUP_ID || state.groups.some(group => group.id === groupId)
}

function assertExactOrder(actual: unknown, expected: string[], description: string): asserts actual is string[] {
  if (!Array.isArray(actual) || actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some(id => typeof id !== 'string') || expected.some(id => !actual.includes(id))) {
    throw new Error(`Invalid ${description}`)
  }
}

function validateFavoritesPreferences(value: unknown, groupIds: Set<string>): asserts value is FavoritesPreferences {
  const preferences = object(value, 'Favorites preferences')
  const keys = ['layout', 'groupView', 'activeTab', 'recentFilter', 'groupSort', 'itemSort', 'collapsedGroups', 'selectedGroup', 'favoritesCollapsed', 'recentCollapsed']
  if (Object.keys(preferences).length !== keys.length || keys.some(key => !Object.hasOwn(preferences, key))) throw new Error('Invalid Favorites preferences')
  if (!['tabs', 'stacked'].includes(preferences.layout as string) || !['outline', 'filter'].includes(preferences.groupView as string) || !['favorites', 'recent'].includes(preferences.activeTab as string) || !['all', 'file', 'folder'].includes(preferences.recentFilter as string)) throw new Error('Invalid Favorites preferences')
  if (!['custom', 'az', 'recent'].includes(preferences.groupSort as string) || !['custom', 'az', 'recent'].includes(preferences.itemSort as string)) throw new Error('Invalid Favorites preferences')
  if (typeof preferences.favoritesCollapsed !== 'boolean' || typeof preferences.recentCollapsed !== 'boolean') throw new Error('Invalid Favorites preferences')
  if (!Array.isArray(preferences.collapsedGroups) || new Set(preferences.collapsedGroups).size !== preferences.collapsedGroups.length || preferences.collapsedGroups.some(id => typeof id !== 'string' || !groupIds.has(id))) throw new Error('Invalid Favorites preferences')
  if (typeof preferences.selectedGroup !== 'string' || (preferences.selectedGroup !== ALL_GROUPS_ID && !groupIds.has(preferences.selectedGroup))) throw new Error('Invalid Favorites preferences')
}

export function validateFavoritesState(value: unknown, platform?: Platform): FavoritesState {
  const state = object(value, 'Favorites state')
  if (state.version !== 2) throw new Error('Unsupported Favorites state version')
  if (typeof state.revision !== 'number' || !Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error('Invalid Favorites revision')
  if (!Array.isArray(state.groups) || !Array.isArray(state.favorites) || !Array.isArray(state.groupOrder)) throw new Error('Invalid Favorites collection')
  const groupIds = new Set<string>([UNGROUPED_GROUP_ID])
  const groupNames = new Set<string>()
  const groups = state.groups.map(raw => {
    const group = object(raw, 'Favorite group')
    if (!validGroupId(group.id) || groupIds.has(group.id)) throw new Error('Invalid or duplicate group identity')
    const name = normalizeGroupName(group.name)
    const foldedName = name.toLocaleLowerCase()
    if (groupNames.has(foldedName)) throw new Error('Invalid or duplicate group name')
    groupIds.add(group.id); groupNames.add(foldedName)
    return { id: group.id, name }
  })
  assertExactOrder(state.groupOrder, groups.map(group => group.id), 'group order')
  const favoriteIds = new Set<string>()
  const favorites: Favorite[] = state.favorites.map(raw => {
    const favorite = object(raw, 'Favorite')
    if ((favorite.kind !== 'file' && favorite.kind !== 'folder') || typeof favorite.path !== 'string' || typeof favorite.id !== 'string' || typeof favorite.groupId !== 'string' || !groupIds.has(favorite.groupId)) throw new Error('Invalid Favorite')
    const pathPlatform = platform ?? (/^[a-zA-Z]:[\\/]|^[/\\]{2}/.test(favorite.path) ? 'win32' : 'darwin')
    const path = normalizePath(favorite.path, pathPlatform)
    if (path !== favorite.path || favorite.id !== locationId(favorite.kind, path, pathPlatform) || favoriteIds.has(favorite.id)) throw new Error('Invalid or duplicate Favorite identity')
    favoriteIds.add(favorite.id)
    return { id: favorite.id, kind: favorite.kind as LocationKind, path, groupId: favorite.groupId }
  })
  const orders = object(state.itemOrder, 'item order')
  if (Object.keys(orders).length !== groupIds.size || Object.keys(orders).some(id => !groupIds.has(id))) throw new Error('Invalid item order')
  const itemOrder: Record<string, string[]> = {}
  for (const groupId of groupIds) {
    const expected = favorites.filter(favorite => favorite.groupId === groupId).map(favorite => favorite.id)
    assertExactOrder(orders[groupId], expected, 'item order')
    itemOrder[groupId] = [...(orders[groupId] as string[])]
  }
  validateFavoritesPreferences(state.preferences, groupIds)
  return {
    version: 2,
    revision: state.revision,
    favorites,
    groups,
    groupOrder: [...(state.groupOrder as string[])],
    itemOrder,
    preferences: { ...(state.preferences as unknown as FavoritesPreferences), collapsedGroups: [...(state.preferences as unknown as FavoritesPreferences).collapsedGroups] },
  }
}

export function applyFavoritesOperation(state: FavoritesState, operation: FavoritesOperation, platform: Platform): FavoritesState {
  const validated = validateFavoritesState(state, platform)
  if (!operation || typeof operation !== 'object') throw new Error('Unknown Favorites operation')
  const next = cloneFavoritesState(validated)
  if (operation.type === 'group:create') {
    if (!validGroupId(operation.id) || groupExists(next, operation.id)) throw new Error('Invalid group identity')
    const name = normalizeGroupName(operation.name)
    if (next.groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Invalid group name')
    next.groups.push({ id: operation.id, name }); next.groupOrder.push(operation.id); next.itemOrder[operation.id] = []
  } else if (operation.type === 'group:rename') {
    if (operation.groupId === UNGROUPED_GROUP_ID) throw new Error('Ungrouped cannot be renamed')
    const group = next.groups.find(candidate => candidate.id === operation.groupId)
    if (!group) throw new Error('Unknown group')
    const name = normalizeGroupName(operation.name)
    if (next.groups.some(candidate => candidate.id !== operation.groupId && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Invalid group name')
    group.name = name
  } else if (operation.type === 'group:delete') {
    if (operation.groupId === UNGROUPED_GROUP_ID) throw new Error('Ungrouped cannot be deleted')
    if (!next.groups.some(group => group.id === operation.groupId)) throw new Error('Unknown group')
    const moved = [...next.itemOrder[operation.groupId]]
    next.favorites.forEach(favorite => { if (favorite.groupId === operation.groupId) favorite.groupId = UNGROUPED_GROUP_ID })
    next.itemOrder[UNGROUPED_GROUP_ID].push(...moved)
    delete next.itemOrder[operation.groupId]
    next.groups = next.groups.filter(group => group.id !== operation.groupId)
    next.groupOrder = next.groupOrder.filter(id => id !== operation.groupId)
    next.preferences.collapsedGroups = next.preferences.collapsedGroups.filter(id => id !== operation.groupId)
    if (next.preferences.selectedGroup === operation.groupId) next.preferences.selectedGroup = ALL_GROUPS_ID
  } else if (operation.type === 'group:reorder') {
    assertExactOrder(operation.groupIds, next.groups.map(group => group.id), 'group order')
    next.groupOrder = [...operation.groupIds]
  } else if (operation.type === 'favorite:add') {
    if (!groupExists(next, operation.groupId)) throw new Error('Unknown destination group')
    const path = normalizePath(operation.path, platform)
    const id = locationId(operation.kind, path, platform)
    if (next.favorites.some(favorite => favorite.id === id)) return next
    next.favorites.push({ id, kind: operation.kind, path, groupId: operation.groupId })
    next.itemOrder[operation.groupId].push(id)
  } else if (operation.type === 'favorite:move') {
    if (!groupExists(next, operation.groupId)) throw new Error('Unknown destination group')
    const favorite = next.favorites.find(candidate => candidate.id === operation.favoriteId)
    if (!favorite) throw new Error('Unknown Favorite')
    if (favorite.groupId === operation.groupId) return next
    next.itemOrder[favorite.groupId] = next.itemOrder[favorite.groupId].filter(id => id !== favorite.id)
    favorite.groupId = operation.groupId
    next.itemOrder[operation.groupId].push(favorite.id)
  } else if (operation.type === 'favorite:remove') {
    const favorite = next.favorites.find(candidate => candidate.id === operation.favoriteId)
    if (!favorite) return next
    next.favorites = next.favorites.filter(candidate => candidate.id !== favorite.id)
    next.itemOrder[favorite.groupId] = next.itemOrder[favorite.groupId].filter(id => id !== favorite.id)
  } else if (operation.type === 'favorite:reorder') {
    if (!groupExists(next, operation.groupId)) throw new Error('Unknown group')
    const expected = next.favorites.filter(favorite => favorite.groupId === operation.groupId).map(favorite => favorite.id)
    assertExactOrder(operation.favoriteIds, expected, 'item order')
    next.itemOrder[operation.groupId] = [...operation.favoriteIds]
  } else if (operation.type === 'favorites:preferences') {
    next.preferences = {
      ...next.preferences,
      ...operation.patch,
      collapsedGroups: operation.patch.collapsedGroups ? [...operation.patch.collapsedGroups] : [...next.preferences.collapsedGroups],
    }
  } else throw new Error('Unknown Favorites operation')
  next.revision += 1
  return validateFavoritesState(next, platform)
}

export interface FavoriteGroupView extends FavoriteGroup {
  ungrouped: boolean
}

const favoritesCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function activityRanks(favorites: Favorite[], activity?: FavoriteActivitySnapshot): { supported: boolean; rank: Map<string, number> } {
  const rank = new Map<string, number>()
  if (!activity || activity.kind === 'unavailable') return { supported: false, rank }
  if (activity.kind === 'timestamps') {
    for (const favorite of favorites) {
      const openedAt = activity.openedAt[favorite.id]
      if (typeof openedAt === 'number' && Number.isFinite(openedAt) && openedAt >= 0) rank.set(favorite.id, -openedAt)
    }
    return { supported: true, rank }
  }
  if (activity.kind === 'global-order') {
    activity.favoriteIds.forEach((id, index) => { if (!rank.has(id)) rank.set(id, index) })
    return { supported: true, rank }
  }
  const kinds = new Set(favorites.map(favorite => favorite.kind))
  if (kinds.size > 1) return { supported: false, rank }
  const order = kinds.has('folder') ? activity.folderIds : activity.fileIds
  order.forEach((id, index) => { if (!rank.has(id)) rank.set(id, index) })
  return { supported: true, rank }
}

function compareActivity(firstId: string, secondId: string, rank: Map<string, number>, retained: Map<string, number>): number {
  const first = rank.get(firstId); const second = rank.get(secondId)
  if (first !== undefined && second === undefined) return -1
  if (first === undefined && second !== undefined) return 1
  return (first ?? 0) - (second ?? 0) || (retained.get(firstId)! - retained.get(secondId)!)
}

export function selectFavoritesInGroup(state: FavoritesState, groupId: string, activity?: FavoriteActivitySnapshot): { favorites: Favorite[]; recentSupported: boolean } {
  const validated = validateFavoritesState(state)
  if (!groupExists(validated, groupId)) throw new Error('Unknown group')
  const byId = new Map(validated.favorites.map(favorite => [favorite.id, favorite]))
  const favorites = validated.itemOrder[groupId].map(id => byId.get(id)!)
  const retained = new Map(favorites.map((favorite, index) => [favorite.id, index]))
  const recency = activityRanks(favorites, activity)
  if (validated.preferences.itemSort === 'az') {
    favorites.sort((first, second) => favoritesCollator.compare(nameOf(first.path), nameOf(second.path)) || retained.get(first.id)! - retained.get(second.id)!)
  } else if (validated.preferences.itemSort === 'recent' && recency.supported) {
    favorites.sort((first, second) => compareActivity(first.id, second.id, recency.rank, retained))
  }
  return { favorites, recentSupported: recency.supported }
}

export function selectFavoriteGroups(state: FavoritesState, activity?: FavoriteActivitySnapshot): { groups: FavoriteGroupView[]; recentSupported: boolean } {
  const validated = validateFavoritesState(state)
  const byId = new Map(validated.groups.map(group => [group.id, group]))
  const groups: FavoriteGroupView[] = validated.groupOrder.map(id => ({ ...byId.get(id)!, ungrouped: false }))
  const retained = new Map(groups.map((group, index) => [group.id, index]))
  const recency = activityRanks(validated.favorites, activity)
  if (validated.preferences.groupSort === 'az') {
    groups.sort((first, second) => favoritesCollator.compare(first.name, second.name) || retained.get(first.id)! - retained.get(second.id)!)
  } else if (validated.preferences.groupSort === 'recent' && recency.supported) {
    const groupRank = new Map<string, number>()
    for (const favorite of validated.favorites) {
      const favoriteRank = recency.rank.get(favorite.id)
      if (favoriteRank === undefined) continue
      const previous = groupRank.get(favorite.groupId)
      if (previous === undefined || favoriteRank < previous) groupRank.set(favorite.groupId, favoriteRank)
    }
    groups.sort((first, second) => compareActivity(first.id, second.id, groupRank, retained))
  }
  groups.push({ id: UNGROUPED_GROUP_ID, name: 'Ungrouped', ungrouped: true })
  return { groups, recentSupported: recency.supported }
}
