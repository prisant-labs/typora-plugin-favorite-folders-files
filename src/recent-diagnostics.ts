import type { Platform } from './model'
import { parseTyporaRecent } from './native-import'

export interface RecentDiagnosticsOptions {
  platform: Platform
  version?: string
  /** The same reader the panel uses, so the report tests Favorites' own code path. */
  read?: () => Promise<unknown>
  available?: () => boolean
  /** Typora's `File` flags; only booleans are reported. */
  typora?: Record<string, unknown>
  timeoutMilliseconds?: number
}

// Fixed reader failure codes from MacRecentReader; any other error is reported by its kind only.
const READER_CODES = ['timeout', 'unavailable', 'bridge', 'disposed']

const pathKind = (value: unknown) => typeof value !== 'string' ? (value === null ? 'null' : typeof value)
  : /^file:/i.test(value) ? 'file URL' : /^(\/|[A-Za-z]:[\\/]|[\\/]{2})/.test(value) ? 'absolute path' : 'other text'
const list = (values: string[]) => [...new Set(values)].join(', ') || 'none'
const rowKeys = (row: unknown) => row && typeof row === 'object' ? `{${Object.keys(row).sort().join(' ')}}` : pathKind(row)
const dateType = (row: unknown) => {
  const date = row && typeof row === 'object' ? (row as { date?: unknown }).date : undefined
  return date === undefined ? 'none' : Object.prototype.toString.call(date).slice(8, -1)
}

function describeList(name: string, rows: unknown): string {
  if (!Array.isArray(rows)) return `  ${name}: not a list (${pathKind(rows)})`
  const paths = rows.map(row => row && typeof row === 'object' ? (row as { path?: unknown }).path : row)
  let line = `  ${name}: ${rows.length} item(s); keys: ${list(rows.map(rowKeys))}; date types: ${list(rows.map(dateType))}; path kinds: ${list(paths.map(pathKind))}`
  if (name === 'folders') {
    const pinned = rows.flatMap((row, index) => row && typeof row === 'object' && (row as { pinned?: unknown }).pinned ? [String(index + 1)] : [])
    line += `; pinned at positions: ${list(pinned)}`
  }
  return line
}

/**
 * A path-free report on Typora's Recent list as Favorites reads it. It lists counts, keys,
 * date types, path kinds and timings, and what the panel would show, but never paths or names.
 * macOS is read twice, because Typora must send its Recent files again for Recent to refresh.
 */
export async function diagnoseRecent(options: RecentDiagnosticsOptions): Promise<string> {
  const lines: string[] = [], problems: string[] = []
  const typora = options.typora ?? {}
  lines.push(`Favorites ${options.version ?? 'unknown version'} Recent diagnostics`)
  lines.push(`Platform: ${options.platform}`)
  lines.push(`Typora: ${['isMac', 'isWK', 'isNode', 'isMacNode'].map(flag => `${flag}=${Boolean(typora[flag])}`).join(', ')}`)
  const supported = (options.platform === 'win32' || options.platform === 'darwin') && options.read
  let available = false
  try { available = Boolean(supported) && (options.available?.() ?? true) } catch { available = false }
  lines.push(`Reader: ${!supported ? 'none for this platform' : available ? 'available' : 'unavailable'}`)
  if (!supported) problems.push('Favorites has no Recent reader for this platform.')
  else if (!available) problems.push('Typora\'s Recent channels are not available in this Typora build.')
  else {
    const reads = options.platform === 'darwin' ? 2 : 1, timeout = options.timeoutMilliseconds ?? 8000
    const worked: boolean[] = []
    for (let number = 1; number <= reads; number++) {
      lines.push('')
      const started = Date.now()
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = Symbol('late')
      const failure = (error: unknown) => ({ error: error instanceof Error ? (READER_CODES.includes(error.message) ? error.message : error.name) : 'error' })
      // A read that settles after the timeout must not surface as an unhandled rejection.
      const attempt = Promise.resolve().then(() => options.read!()).then(raw => ({ raw }), failure)
      const outcome: { raw: unknown } | { error: string } | typeof late = await Promise.race([
        attempt, new Promise<typeof late>(resolve => { timer = setTimeout(() => resolve(late), timeout) }),
      ])
      clearTimeout(timer)
      if (outcome === late) {
        lines.push(`Read ${number}: no answer after ${timeout / 1000} s`)
        problems.push(number === 2 && worked[0] ? 'Read 2 got no answer after read 1 worked, so Recent would work only once.' : `Read ${number} got no answer.`)
        worked.push(false); continue
      }
      if ('error' in outcome) {
        lines.push(`Read ${number}: failed (${outcome.error})`)
        problems.push(number === 2 && worked[0] ? 'Read 2 failed after read 1 worked, so Recent would work only once.' : `Read ${number} failed (${outcome.error}).`)
        worked.push(false); continue
      }
      lines.push(`Read ${number}: answered after ${Date.now() - started} ms`)
      const raw = outcome.raw as { files?: unknown; folders?: unknown } | null
      for (const name of ['files', 'folders'] as const) lines.push(describeList(name, raw && typeof raw === 'object' ? raw[name] : undefined))
      const parsed = parseTyporaRecent(raw, options.platform)
      if (parsed.status === 'ready') {
        const files = parsed.entries.filter(row => row.kind === 'file').length, folders = parsed.entries.length - files
        lines.push(`  Favorites shows: ${parsed.order === 'per-kind' ? 'Typora\'s order' : 'Most recent first'}; ${files} Markdown file(s), ${folders} folder(s)`)
        worked.push(true)
      } else {
        lines.push(`  Favorites shows: ${parsed.status === 'error' ? 'an error' : parsed.status} (${parsed.message ?? 'no message'})`)
        problems.push(`Read ${number}: Favorites would not show a list.`)
        worked.push(false)
      }
    }
  }
  lines.push('')
  if (problems.length) { lines.push('RESULT: FAIL'); for (const problem of problems) lines.push(`- ${problem}`) }
  else lines.push(`RESULT: PASS. ${options.platform === 'darwin' ? 'Both reads worked, so Recent can refresh.' : 'The read worked.'}`)
  return lines.join('\n')
}
