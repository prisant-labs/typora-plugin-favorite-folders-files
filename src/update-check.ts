/** The parts of Core's Plugin Marketplace that Favorites uses. Core keeps this data in memory only. */
export interface MarketplaceLike {
  pluginList?: unknown[]
  pluginStats?: Record<string, unknown>
  readonly isLoaded?: boolean
  getPlugin(id: string): { newestVersion?: string } | undefined
  loadCommunityPlugins(): Promise<void>
}
export interface PluginManagerLike { marketplace?: MarketplaceLike; updatePlugin(id: string): Promise<void> }
export interface UpdateRecord { checkForUpdates: boolean; checked?: { at: number; version?: string } }
export interface UpdateRecordStore {
  /** Never rejects: an unreadable record reads as the defaults. */
  read(): Promise<UpdateRecord>
  /** Reads and writes the record in one transaction, so changes from two windows never overwrite each other. */
  update(change: (record: UpdateRecord) => UpdateRecord): Promise<UpdateRecord>
}
export interface UpdateState { version?: string; enabled: boolean }

const CHECK_INTERVAL = 24 * 60 * 60 * 1000
const RETRY_INTERVAL = 60 * 60 * 1000
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/

/** Compares plain major.minor.patch versions; undefined when either is anything else. */
export function compareVersions(a: string, b: string): number | undefined {
  const left = typeof a === 'string' ? VERSION.exec(a) : null, right = typeof b === 'string' ? VERSION.exec(b) : null
  if (!left || !right) return undefined
  for (let index = 1; index <= 3; index++) {
    const difference = Number(left[index]) - Number(right[index])
    if (difference) return Math.sign(difference)
  }
  return 0
}

function functions<T extends object>(value: unknown, ...names: string[]): T | undefined {
  return value && typeof value === 'object' && names.every(name => typeof (value as Record<string, unknown>)[name] === 'function') ? value as T : undefined
}

type Checked = NonNullable<UpdateRecord['checked']>
const newer = (a?: Checked, b?: Checked) => !a ? b : !b ? a : b.at > a.at ? b : a

/**
 * Tells one Typora window whether Core's Marketplace has a newer Favorites, and starts Core's update.
 * Favorites never requests anything itself: it reads Core's in-memory data, and with the setting on
 * asks Core to load its Marketplace lists at most once a day across windows.
 */
export class UpdateNotifier {
  private record: UpdateRecord = { checkForUpdates: true }
  private available?: string
  private emitted: UpdateState = { enabled: true }
  private failedAt?: number
  private running?: Promise<void>
  private updating?: Promise<void>
  private disposed = false
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number

  constructor(private readonly options: { id: string; installed: string; plugins: () => PluginManagerLike | undefined; store: UpdateRecordStore; now?: () => number }) {
    this.now = options.now ?? Date.now
  }

  get state(): UpdateState { return { version: this.available, enabled: this.record.checkForUpdates } }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  /** Shows what Core already knows, then asks Core to check when the setting is on and a check is due. */
  check(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.running ??= this.run().finally(() => { this.running = undefined })
    return this.running
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return
    const saved = await this.options.store.update(record => ({ ...record, checkForUpdates: enabled }))
    if (this.disposed) return
    this.record = { ...saved, checked: newer(saved.checked, this.record.checked) }
    this.emit()
    if (enabled) void this.check()
  }

  /** Starts Core's own update. Resolves or rejects only if Core did not unload Favorites. */
  update(): Promise<void> {
    this.updating ??= this.startUpdate().finally(() => { this.updating = undefined })
    return this.updating
  }

  dispose(): void { this.disposed = true; this.listeners.clear() }

  private async run(): Promise<void> {
    let stored: UpdateRecord
    try { stored = await this.options.store.read() } catch { stored = { checkForUpdates: true } }
    if (this.disposed) return
    // A completed check that this window could not save still counts here, so a failing store never repeats requests.
    this.record = { ...stored, checked: newer(stored.checked, this.record.checked) }
    this.refresh()
    const now = this.now(), checked = this.record.checked
    if (!this.record.checkForUpdates) return
    if (checked && checked.at <= now && now - checked.at < CHECK_INTERVAL) return
    if (this.failedAt !== undefined && now - this.failedAt < RETRY_INTERVAL) return
    let version: string | undefined
    try { version = await this.newest() } catch {
      if (!this.disposed) this.failedAt = now
      return
    }
    if (this.disposed) return
    this.failedAt = undefined
    const result: Checked = version === undefined ? { at: now } : { at: now, version }
    this.record = { ...this.record, checked: newer(this.record.checked, result) }
    this.refresh()
    try { await this.options.store.update(record => ({ ...record, checked: newer(record.checked, result) })) } catch { /* Kept in memory; the next window checks again. */ }
  }

  private marketplace(): MarketplaceLike | undefined {
    return functions<MarketplaceLike>(this.options.plugins()?.marketplace, 'getPlugin', 'loadCommunityPlugins')
  }

  /**
   * The newest version in Core's freshly loaded lists, or undefined when Favorites is not listed or has no statistics.
   * Reads the lists directly: Core's getPluginNewestVersion would fall back to GitHub's REST API.
   * Throws when Core's lists did not load, so the check is retried within the hour.
   */
  private async newest(): Promise<string | undefined> {
    const marketplace = this.marketplace()
    if (!marketplace) throw new Error('Core\'s Plugin Marketplace is unavailable.')
    await marketplace.loadCommunityPlugins()
    const loaded = typeof marketplace.isLoaded === 'boolean' ? marketplace.isLoaded : Array.isArray(marketplace.pluginList) && marketplace.pluginList.length > 0
    const stats = marketplace.pluginStats
    // Core turns a failed statistics download into an empty object.
    if (!loaded || (stats && typeof stats === 'object' && Object.keys(stats).length === 0)) throw new Error('Core\'s Plugin Marketplace did not load.')
    const version = marketplace.getPlugin(this.options.id)?.newestVersion
    return typeof version === 'string' ? version : undefined
  }

  /** Recomputes the newer version from Core's memory and the last completed check; notifies only on a change. */
  private refresh() {
    const candidates: unknown[] = []
    try { candidates.push(this.marketplace()?.getPlugin(this.options.id)?.newestVersion) } catch { /* Core changed shape: show nothing from it. */ }
    const checked = this.record.checked, now = this.now()
    if (checked && checked.at <= now && now - checked.at < CHECK_INTERVAL) candidates.push(checked.version)
    let best: string | undefined
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || compareVersions(candidate, this.options.installed) !== 1) continue
      if (!best || compareVersions(candidate, best) === 1) best = candidate
    }
    this.available = best
    this.emit()
  }

  private async startUpdate(): Promise<void> {
    const manager = functions<PluginManagerLike>(this.options.plugins(), 'updatePlugin')
    const marketplace = this.marketplace()
    if (!manager || !marketplace) throw new Error('Community Plugin Core cannot update plugins in this version.')
    // Core's update re-reads its in-memory lists: they may be empty in this window, or predate the release the
    // pill names, and then Core returns early. Reload only then: a reload whose statistics download fails makes
    // Core delete every newestVersion, so a needless one can break an update that would have worked.
    // The user's click allows this one request even with the check off.
    const known = marketplace.getPlugin(this.options.id)?.newestVersion
    const current = typeof known === 'string' && this.available !== undefined && (compareVersions(known, this.available) ?? -1) >= 0
    if (!current) await marketplace.loadCommunityPlugins()
    if (!marketplace.getPlugin(this.options.id)) throw new Error('Favorites is not listed in the Plugin Marketplace right now.')
    await manager.updatePlugin(this.options.id)
  }

  private emit() {
    const state = this.state
    if (this.disposed || (state.version === this.emitted.version && state.enabled === this.emitted.enabled)) return
    this.emitted = state
    this.listeners.forEach(listener => listener())
  }
}
