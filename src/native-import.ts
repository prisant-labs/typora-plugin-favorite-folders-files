import { normalizePath, type LocationKind, type Platform } from './model'
import { isMarkdown } from './host'
import { normalizeHistory, type NativeHistorySnapshot } from './native-history'

/** Typora's own Recent menu sorts with `-a.date + b.date`: numbers, numeric strings and Dates coerce. */
function sortKey(value: unknown): number | undefined {
  const coercible = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') || Object.prototype.toString.call(value) === '[object Date]'
  const key = coercible ? Number(value) : Number.NaN
  return Number.isFinite(key) && key >= 0 ? key : undefined
}

/** Windows' own Recent consumer sorts both lists by date. Its epoch is unknown. */
export function parseTyporaRecent(raw: unknown, platform: Platform): NativeHistorySnapshot {
  if (platform !== 'win32') return normalizeHistory(undefined, platform)
  const invalid: NativeHistorySnapshot = { status: 'error', order: 'global', entries: [], message: 'Could not read Typora Recent: an unsupported response was returned.' }
  if (!raw || typeof raw !== 'object') return invalid
  const lists = raw as Record<string, unknown>
  if (!Array.isArray(lists.files) || !Array.isArray(lists.folders) || lists.files.length + lists.folders.length > 10000) return invalid
  const rows: Array<{ kind: LocationKind; path: string; date?: number }> = []
  try {
    for (const [key, kind] of [['files', 'file'], ['folders', 'folder']] as const) {
      for (const rawRow of lists[key] as unknown[]) {
        if (!rawRow || typeof rawRow !== 'object') return invalid
        const row = rawRow as Record<string, unknown>
        if (typeof row.path !== 'string') return invalid
        const path = normalizePath(row.path, platform)
        if (kind === 'file' && !isMarkdown(path)) continue
        rows.push({ kind, path, date: sortKey(row.date) })
      }
    }
  } catch { return invalid }
  const ordered = rows.every(row => row.date !== undefined)
  if (ordered) rows.sort((first, second) => second.date! - first.date!)
  // Native dates are sort keys only: no fabricated wall-clock ages or native pins.
  return normalizeHistory({ status: 'ready', order: ordered ? 'global' : 'per-kind', entries: rows.map(({ kind, path }) => ({ kind, path })) }, platform)
}
