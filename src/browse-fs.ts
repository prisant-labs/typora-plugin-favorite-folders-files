import { isMarkdown } from './host'
import { normalizePath, type Platform } from './model'

/** Read-only folder listings for Browse. Nothing here creates, moves, renames or deletes anything. */
export interface BrowseEntry { kind: 'file' | 'folder'; name: string; path: string }
export interface BrowseSource {
  /** Folders, then Markdown files, without hidden or system entries. Rejects with a BrowseListError. */
  list(folder: string): Promise<BrowseEntry[]>
  drives(): Promise<string[]>
  home(): string | undefined
}
export type BrowseListReason = 'denied' | 'missing' | 'failed'
const MESSAGES: Record<BrowseListReason, string> = { denied: 'No access', missing: 'Unavailable', failed: 'Could not be read' }
/** Its message never names the path: the panel shows it beside the folder. */
export class BrowseListError extends Error {
  constructor(readonly reason: BrowseListReason) { super(MESSAGES[reason]) }
}

function hidden(name: string, platform: Platform) {
  // Windows marks its own folders with a leading $ ($Recycle.Bin, $WinREAgent).
  return name.startsWith('.') || (platform === 'win32' && (name.startsWith('$') || name === 'System Volume Information'))
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
function present(entries: Array<{ kind: 'file' | 'folder'; name: string }>, folder: string, platform: Platform): BrowseEntry[] {
  const shown: BrowseEntry[] = []
  for (const { kind, name } of entries) {
    if (hidden(name, platform) || (kind === 'file' && !isMarkdown(name))) continue
    try { shown.push({ kind, name, path: normalizePath(`${folder}/${name}`, platform) }) } catch { /* Not a usable path. */ }
  }
  return shown.sort((first, second) => (first.kind === second.kind ? 0 : first.kind === 'folder' ? -1 : 1) || collator.compare(first.name, second.name))
}
function homeOf(read: (() => string) | undefined, platform: Platform) {
  try { return read ? normalizePath(read(), platform) : undefined } catch { return undefined }
}

export interface NodeDirent { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
export interface NodeFsPromises {
  readdir(path: string, options: { withFileTypes: true }): Promise<NodeDirent[]>
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>
}

/** Typora's Electron builds (Windows), through the `fs` module Typora exposes to page code. */
export function nodeBrowseSource(fsp: NodeFsPromises, platform: Platform, home?: () => string): BrowseSource {
  return {
    async list(folder) {
      let entries: NodeDirent[]
      try { entries = await fsp.readdir(folder, { withFileTypes: true }) } catch (error) {
        const code = (error as { code?: string } | undefined)?.code
        throw new BrowseListError(code === 'EPERM' || code === 'EACCES' ? 'denied' : code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'failed')
      }
      const typed = await Promise.all(entries.map(async entry => {
        if (hidden(entry.name, platform)) return undefined
        if (entry.isDirectory()) return { kind: 'folder' as const, name: entry.name }
        if (entry.isFile()) return { kind: 'file' as const, name: entry.name }
        if (!entry.isSymbolicLink()) return undefined
        // Links and Windows junctions take their target's kind; a broken link is left out.
        try {
          const target = await fsp.stat(`${folder.endsWith('/') ? folder : `${folder}/`}${entry.name}`)
          return target.isDirectory() ? { kind: 'folder' as const, name: entry.name } : target.isFile() ? { kind: 'file' as const, name: entry.name } : undefined
        } catch { return undefined }
      }))
      return present(typed.filter(entry => entry !== undefined), folder, platform)
    },
    async drives() {
      if (platform !== 'win32') return ['/']
      // A disconnected network drive can hold a stat for seconds, and each held stat blocks one of
      // Node's few file-system threads. Two at a time leaves the others free for listings.
      const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), found = new Set<string>()
      let next = 0
      const probe = async () => {
        while (next < letters.length) {
          const root = `${letters[next++]}:/`
          try { if ((await fsp.stat(root)).isDirectory()) found.add(root) } catch { /* No drive. */ }
        }
      }
      await Promise.all([probe(), probe()])
      return letters.map(letter => `${letter}:/`).filter(root => found.has(root))
    },
    home: () => homeOf(home, platform),
  }
}

export interface MacCommandResult { ok: boolean; out: string; error: string }
export type MacCommandRunner = (command: string) => Promise<MacCommandResult>
/** POSIX single quotes: nothing inside them is special except the quote itself. */
export function shellQuote(text: string) { return `'${text.replace(/'/g, `'\\''`)}'` }

/**
 * Typora's macOS build has no Node, so a listing is one `ls` through Typora's runCommand bridge.
 * Core 2.10.21's own macOS `fs.list` interpolates the path unquoted (see host.ts on stat/access);
 * this quotes every path, and is the only shell command Favorites runs.
 */
export function macBrowseSource(run: MacCommandRunner, home?: () => string): BrowseSource {
  const list = async (folder: string) => {
    let result: MacCommandResult
    try { result = await run(`/bin/ls -1pL ${shellQuote(folder)}`) } catch { throw new BrowseListError('failed') }
    // ls exits non-zero for one unreadable entry (a broken link) and still prints the rest.
    if (!result.ok && !result.out.trim()) {
      throw new BrowseListError(/Permission denied|Operation not permitted/i.test(result.error) ? 'denied' : /No such file|Not a directory/i.test(result.error) ? 'missing' : 'failed')
    }
    // -p marks folders with a trailing slash; -L gives a link its target's kind.
    const entries = result.out.split('\n').filter(line => line && line !== '/').map(line => line.endsWith('/') ? { kind: 'folder' as const, name: line.slice(0, -1) } : { kind: 'file' as const, name: line })
    return present(entries, folder, 'darwin')
  }
  return {
    list,
    async drives() {
      try { return (await list('/Volumes')).filter(entry => entry.kind === 'folder').map(entry => entry.path) } catch { return [] }
    },
    home: () => homeOf(home, 'darwin'),
  }
}

export interface MacCommandBridge { callHandler(name: string, ...args: unknown[]): unknown }
/** Same call shape as Core's own macOS shell runner: `{ cwd, args }`, answered with `[success, out, error]`. */
export function macCommandRunner(bridge: () => MacCommandBridge | undefined, folder: () => string | undefined, timeoutMilliseconds = 10000): MacCommandRunner {
  return command => new Promise<MacCommandResult>((resolve, reject) => {
    const native = bridge()
    if (!native) { reject(new Error('Typora\'s macOS bridge is unavailable.')); return }
    const timer = setTimeout(() => reject(new Error('The folder listing timed out.')), timeoutMilliseconds)
    try {
      native.callHandler('controller.runCommand', { cwd: folder() || '/', args: command }, (answer: unknown) => {
        clearTimeout(timer)
        const [success, out, error] = Array.isArray(answer) ? answer : []
        resolve({ ok: Boolean(success), out: typeof out === 'string' ? out : '', error: typeof error === 'string' ? error : '' })
      })
    } catch (error) { clearTimeout(timer); reject(error) }
  })
}
