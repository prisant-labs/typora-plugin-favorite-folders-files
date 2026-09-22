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
