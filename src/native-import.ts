import { normalizePath, type LocationKind, type Platform } from './model'
import { isMarkdown } from './host'
import { normalizeHistory, type NativeHistorySnapshot } from './native-history'

// Full ISO 8601 date-time with a zone. Looser text that Date.parse accepts is not a date here.
const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * Typora stores file dates as epoch milliseconds but folder dates as ISO 8601 text, the same
 * instant scale. Numbers, numeric strings and Dates coerce as in Typora's own `-a.date + b.date`.
 */
function sortKey(value: unknown): number | undefined {
  let key = Number.NaN
  if (typeof value === 'number' || Object.prototype.toString.call(value) === '[object Date]') key = Number(value)
  else if (typeof value === 'string' && value.trim() !== '') key = isoDateTime.test(value.trim()) ? Date.parse(value) : Number(value)
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
