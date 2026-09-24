import { locationId, normalizePath, type FavoriteActivitySnapshot, type LocationKind, type Platform } from './model'
import { isMarkdown } from './host'

export interface RecentLocation { id: string; kind: LocationKind; path: string; openedAt?: number }
export interface HistoryInput {
  status: 'ready' | 'recording-off' | 'unavailable' | 'error'
  order?: 'global' | 'per-kind' | 'timestamps'
  entries?: Array<{ kind: LocationKind; path: string; openedAt?: number }>
  message?: string
}
export interface NativeHistorySnapshot {
  status: HistoryInput['status']
  order: 'global' | 'per-kind' | 'timestamps'
  entries: RecentLocation[]
  message?: string
}

/** Only verified native providers may supply input. No durable or legacy fallback. */
export function normalizeHistory(input: HistoryInput | undefined, platform: Platform): NativeHistorySnapshot {
  const unavailable: NativeHistorySnapshot = { status: 'unavailable', order: 'global', entries: [], message: 'Native Recent history is not available in this candidate.' }
  if (!input || typeof input !== 'object' || !['ready', 'recording-off', 'unavailable', 'error'].includes(input.status) || (input.message !== undefined && typeof input.message !== 'string')) return unavailable
  if (input.status !== 'ready') return { ...unavailable, status: input.status, message: input.message || (input.status === 'recording-off' ? 'Recent history recording is turned off in Typora.' : unavailable.message) }
  if (!input.order || !['global', 'per-kind', 'timestamps'].includes(input.order) || !Array.isArray(input.entries)) return unavailable
  try {
    const entries: RecentLocation[] = []
    const seen = new Map<string, RecentLocation>()
    for (const row of input.entries) {
      if (!row || (row.kind !== 'file' && row.kind !== 'folder') || typeof row.path !== 'string') return unavailable
      const path = normalizePath(row.path, platform)
      const id = locationId(row.kind, path, platform)
      if (row.kind === 'file' && !isMarkdown(path)) continue
      const openedAt = typeof row.openedAt === 'number' && Number.isFinite(row.openedAt) && row.openedAt >= 0 ? row.openedAt : undefined
      if (input.order === 'timestamps' && openedAt === undefined) return unavailable
      const previous = seen.get(id)
      if (previous) {
        if (input.order === 'timestamps' && openedAt! > previous.openedAt!) { previous.openedAt = openedAt; previous.path = path }
        continue
      }
      const entry = { id, kind: row.kind, path, ...(openedAt !== undefined ? { openedAt } : {}) }
      seen.set(id, entry); entries.push(entry)
    }
    if (input.order === 'timestamps') entries.sort((a, b) => b.openedAt! - a.openedAt!)
    return { status: 'ready', order: input.order, entries }
  } catch { return unavailable }
}

export function selectRecent(history: NativeHistorySnapshot, filter: 'all' | LocationKind): RecentLocation[] {
  if (history.status !== 'ready' || (filter === 'all' && history.order === 'per-kind')) return []
  return history.entries.filter(row => filter === 'all' || row.kind === filter)
}

export function historyActivity(history: NativeHistorySnapshot): FavoriteActivitySnapshot {
  if (history.status !== 'ready') return { kind: 'unavailable' }
  if (history.order === 'timestamps') return { kind: 'timestamps', openedAt: Object.fromEntries(history.entries.map(row => [row.id, row.openedAt!])) }
  if (history.order === 'global') return { kind: 'global-order', favoriteIds: history.entries.map(row => row.id) }
  return { kind: 'per-kind-order', fileIds: history.entries.filter(row => row.kind === 'file').map(row => row.id), folderIds: history.entries.filter(row => row.kind === 'folder').map(row => row.id) }
}
