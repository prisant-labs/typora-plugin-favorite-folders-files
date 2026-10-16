import { BrowseListError, type BrowseSource } from './browse-fs'
import { browseRows, browseTops, DRIVES_KEY, folderName, type BrowseFolder, type BrowseFolders } from './browse-model'
import { cloneBrowseRecord, DEFAULT_BROWSE, normalizeBrowseRecord, type BrowseRecord, type PanelTab } from './browse-store'
import { locationId, normalizePath, type Platform } from './model'

export interface BrowseRecordStore {
  read(): Promise<BrowseRecord>
  update(change: (record: BrowseRecord) => BrowseRecord): Promise<BrowseRecord>
  close(): Promise<void>
}
export interface BrowseSnapshot {
  /** False when this Typora window offers no way to list folders. */
  available: boolean
  record: BrowseRecord
  home?: string
  folders: BrowseFolders
  /** The record has been read, so changes can be saved. */
  writable: boolean
}
export interface BrowseRootsChange { roots: string[]; home: boolean; drives: boolean }
const SAVE_FAILED = 'Browse settings could not be saved.'
const MAX_CACHED = 300

/**
 * Browse's record and folder listings. Listings are read only while the panel is on screen, one
 * expanded folder at a time, and never on the storage poll: on macOS each one is a shell command.
 */
export class BrowseController {
  private record: BrowseRecord = normalizeBrowseRecord(DEFAULT_BROWSE, 'win32')
  private readonly folders = new Map<string, BrowseFolder>()
  private readonly generations = new Map<string, number>()
  private readonly home?: string
  private readonly listeners = new Set<(snapshot: BrowseSnapshot) => void>()
  private readonly disposers: Array<() => void> = []
  private ready = false
  private started = false
  private disposed = false
  private writes = 0
  private refreshedAt?: number
  private published?: string

  constructor(private readonly store: BrowseRecordStore, private readonly source: BrowseSource | undefined, private readonly platform: Platform, private readonly options: {
    pollMilliseconds?: number
    /** Minimum gap between background refreshes; `refresh(true)` skips it. */
    refreshMinIntervalMilliseconds?: number
    isVisible?: () => boolean
  } = {}) {
    this.record = normalizeBrowseRecord(DEFAULT_BROWSE, platform)
    this.home = source?.home()
  }

  get snapshot(): BrowseSnapshot {
    const folders: BrowseFolders = {}
    for (const [key, folder] of this.folders) folders[key] = { ...folder, entries: folder.entries.map(entry => ({ ...entry })) }
    return {
      available: Boolean(this.source), record: cloneBrowseRecord(this.record), ...(this.home ? { home: this.home } : {}),
      folders, writable: this.ready && !this.disposed,
    }
  }

  subscribe(listener: (snapshot: BrowseSnapshot) => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    try { listener(this.snapshot) } catch { /* One renderer must not break the others. */ }
    return () => { this.listeners.delete(listener) }
  }

  /** Publishes only a changed snapshot, so the storage poll never rebuilds an unchanged tree. */
  private publish() {
    if (this.disposed) return
    const snapshot = this.snapshot, serialized = JSON.stringify(snapshot)
    if (serialized === this.published) return
    this.published = serialized
    for (const listener of this.listeners) try { listener(snapshot) } catch { /* As above. */ }
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return
    this.started = true
    if ((this.options.pollMilliseconds ?? 2000) > 0) {
      const timer = setInterval(() => { void this.load() }, this.options.pollMilliseconds ?? 2000)
      this.disposers.push(() => clearInterval(timer))
    }
    if (typeof window !== 'undefined') {
      const refresh = () => { if (!document.hidden) this.refresh() }
      window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
      this.disposers.push(() => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) })
    }
    await this.load()
  }

  private async load() {
    const record = await this.store.read()
    // A pending write already shows its change; the next read will include it.
    if (this.disposed || this.writes > 0) return
    this.record = record; this.ready = true
    this.publish(); this.ensure()
  }

  private get visible() {
    try { return this.options.isVisible?.() ?? true } catch { return false }
  }

  /** Lists every expanded folder on screen that has no listing yet. */
  private ensure() {
    if (!this.source || this.disposed || !this.ready || !this.visible) return
    const { missing } = browseRows(browseTops(this.record, this.home, this.platform), Object.fromEntries(this.folders), new Set(this.record.expanded), this.platform)
    for (const { key, path } of missing) this.list(key, path)
  }

  /** Reads the expanded folders on screen again, for files added or removed outside Typora. */
  refresh(force = false) {
    if (!this.source || this.disposed || !this.ready || !this.visible) return
    const now = Date.now()
    if (!force && this.refreshedAt !== undefined && now - this.refreshedAt < (this.options.refreshMinIntervalMilliseconds ?? 5000)) return
    this.refreshedAt = now
    const expanded = new Set(this.record.expanded), listed = new Set<string>()
    for (const row of browseRows(browseTops(this.record, this.home, this.platform), Object.fromEntries(this.folders), expanded, this.platform).rows) {
      if (row.expanded && this.folders.has(row.key) && !listed.has(row.key)) { listed.add(row.key); this.list(row.key, row.path) }
    }
    this.ensure()
  }

  private list(key: string, path?: string) {
    const source = this.source
    if (!source || (key !== DRIVES_KEY && path === undefined)) return
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)
    const current = () => !this.disposed && this.generations.get(key) === generation
    this.folders.set(key, { status: 'loading', entries: this.folders.get(key)?.entries ?? [] })
    const task = key === DRIVES_KEY
      ? source.drives().then(paths => paths.map(root => ({ kind: 'folder' as const, name: folderName(root), path: root })))
      : source.list(path!)
    void task.then(entries => {
      if (current()) this.folders.set(key, { status: 'ready', entries })
    }, error => {
      if (current()) this.folders.set(key, { status: 'error', entries: [], error: error instanceof BrowseListError ? error.message : 'Could not be read' })
    }).then(() => {
      if (!current()) return
      this.trim(); this.publish(); this.ensure()
    })
    this.publish()
  }

  /** Forgets the listings of collapsed folders, oldest first, beyond a few hundred. */
  private trim() {
    const expanded = new Set(this.record.expanded)
    for (const key of this.folders.keys()) {
      if (this.folders.size <= MAX_CACHED) return
      if (!expanded.has(key)) { this.folders.delete(key); this.generations.delete(key) }
    }
  }

  /** Shows the change at once, then saves it; a failed save goes back to the stored record. */
  private async write(change: (record: BrowseRecord) => BrowseRecord): Promise<void> {
    if (!this.ready || this.disposed) return
    this.record = normalizeBrowseRecord(change(cloneBrowseRecord(this.record)), this.platform)
    this.publish()
    this.writes++
    try {
      const saved = await this.store.update(change)
      if (--this.writes === 0 && !this.disposed) { this.record = saved; this.publish() }
    } catch {
      if (--this.writes === 0) await this.load()
      throw new Error(SAVE_FAILED)
    }
  }

  async toggle(key: string, path?: string): Promise<void> {
    if (!this.source) return
    const expanding = !this.record.expanded.includes(key)
    const saved = this.write(record => ({ ...record, expanded: [...record.expanded.filter(candidate => candidate !== key), ...(expanding ? [key] : [])] }))
    // A kept listing shows at once and is read again behind it.
    if (expanding && this.folders.has(key)) this.list(key, path)
    else this.ensure()
    await saved
  }

  setActive(active: boolean) { return this.write(record => ({ ...record, active })) }
  setCollapsed(collapsed: boolean) { return this.write(record => ({ ...record, collapsed })) }
  setOrder(order: PanelTab[]) { return this.write(record => ({ ...record, order: [...order] })) }

  async addRoot(path: string): Promise<void> {
    const root = normalizePath(path, this.platform)
    await this.write(record => ({ ...record, roots: [...record.roots, root] }))
  }

  async removeRoot(path: string): Promise<void> {
    const id = locationId('folder', path, this.platform)
    await this.write(record => ({ ...record, roots: record.roots.filter(root => locationId('folder', root, this.platform) !== id) }))
  }

  async saveRoots(change: BrowseRootsChange): Promise<void> {
    const roots = change.roots.map(root => normalizePath(root, this.platform))
    await this.write(record => ({ ...record, roots, home: change.home, drives: change.drives }))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposers.splice(0).forEach(dispose => dispose())
    this.listeners.clear()
    void this.store.close()
  }
}
