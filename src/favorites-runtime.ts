import { FavoritesController } from './controller'
import type { FavoritesDraft } from './editor-state'
import type { FavoritesPanelSnapshot } from './favorites-panel'
import { isMarkdown, type Host, type OpenOptions } from './host'
import { locationId, normalizePath, type FavoritesOperation, type LocationKind } from './model'
import { normalizeHistory } from './native-history'
import { parseTyporaRecent } from './native-import'

/** Native observation and navigation around the host-independent collection. */
export class FavoritesRuntime {
  private current: FavoritesPanelSnapshot['current'] = {}
  private unavailable = new Set<string>()
  private actionError?: string
  private failedTarget?: string
  private actionGeneration = 0
  private refreshing?: Promise<void>
  private started = false
  private disposed = false
  private disposers: Array<() => void> = []
  private listeners = new Set<(snapshot: FavoritesPanelSnapshot) => void>()
  private history: FavoritesPanelSnapshot['history']
  private historyGeneration = 0
  private historyTask?: Promise<void>
  private cancelHistoryRead?: () => void
  private historyReadAt?: number
  private historyError?: string

  constructor(private readonly host: Host, readonly collection: FavoritesController, private readonly options: {
    pollMilliseconds?: number
    readHistory?: () => Promise<unknown>
    historyTimeoutMilliseconds?: number
    /** Minimum gap between background reads of Typora's Recent list. */
    historyMinIntervalMilliseconds?: number
    /** Typora's Recent list is read only while the panel is on screen. */
    isVisible?: () => boolean
  } = {}) {
    this.history = normalizeHistory(undefined, host.platform)
  }

  private get historyAvailable() { return this.host.platform === 'win32' && Boolean(this.options.readHistory) && !this.disposed }

  get snapshot(): FavoritesPanelSnapshot {
    return {
      state: this.collection.state, platform: this.host.platform, current: { ...this.current },
      history: { ...this.history, entries: this.history.entries.map(row => ({ ...row })) },
      historySource: { available: this.historyAvailable, loading: Boolean(this.historyTask), error: this.historyError },
      writable: this.collection.writable && !this.disposed,
      error: this.collection.error || this.actionError, unavailable: new Set(this.unavailable),
    }
  }

  subscribe(listener: (snapshot: FavoritesPanelSnapshot) => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    this.notify(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(listener: (snapshot: FavoritesPanelSnapshot) => void) {
    try { listener(this.snapshot) } catch { /* One renderer must not break native observation. */ }
  }

  private publish() {
    if (!this.disposed) for (const listener of this.listeners) this.notify(listener)
  }

  private observe() {
    if (this.disposed) return
    const current: FavoritesPanelSnapshot['current'] = {}
    try {
      const actual = this.host.current()
      for (const kind of ['file', 'folder'] as const) {
        try {
          const path = actual[kind]
          if (!path || (kind === 'file' && !isMarkdown(path))) continue
          const normalized = normalizePath(path, this.host.platform)
          current[kind] = normalized
          const id = locationId(kind, normalized, this.host.platform)
          this.unavailable.delete(id)
          if (this.failedTarget === id) { this.actionError = undefined; this.failedTarget = undefined }
        } catch { /* Unsaved or malformed host path is not a navigation target. */ }
      }
    } catch { /* A temporary host read failure leaves no invented current path. */ }
    this.current = current
    this.publish()
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return
    this.started = true
    // Opening a file or folder changes Typora's Recent list, so navigation also re-reads it.
    this.disposers.push(this.collection.subscribe(() => this.publish()), this.host.subscribe(() => { this.observe(); void this.syncHistory() }))
    // The storage poll never reads Typora's Recent list: show, focus and navigation cover every change.
    const refresh = () => { void this.refresh() }
    const refreshAll = () => { refresh(); void this.syncHistory() }
    if (typeof window !== 'undefined') {
      const visible = () => { if (!document.hidden) refreshAll() }
      window.addEventListener('focus', refreshAll)
      document.addEventListener('visibilitychange', visible)
      this.disposers.push(() => { window.removeEventListener('focus', refreshAll); document.removeEventListener('visibilitychange', visible) })
    }
    if ((this.options.pollMilliseconds ?? 2000) > 0) {
      const timer = setInterval(refresh, this.options.pollMilliseconds ?? 2000)
      this.disposers.push(() => clearInterval(timer))
    }
    this.observe()
    void this.syncHistory(true)
    await this.refresh()
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.refreshing) return this.refreshing
    this.refreshing = this.collection.refresh()
      .catch(() => { /* The collection publishes the error and disables editing. */ })
      .then(() => { if (!this.disposed) this.observe() })
      .finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  async idle(): Promise<void> { await this.collection.idle(); await this.refreshing }
  /**
   * Live view of Typora's own Recent list: read while the panel is visible, kept in memory,
   * never saved or written back. Background triggers are throttled; `force` skips the throttle.
   */
  syncHistory(force = false): Promise<void> {
    if (!this.historyAvailable || !(this.options.isVisible?.() ?? true)) return Promise.resolve()
    if (this.historyTask) return this.historyTask
    const readAt = this.historyReadAt
    if (!force && readAt !== undefined && Date.now() - readAt < (this.options.historyMinIntervalMilliseconds ?? 1000)) return Promise.resolve()
    const generation = ++this.historyGeneration, firstRead = this.history.status !== 'ready'
    const before = JSON.stringify([this.history, this.historyError])
    let timer: ReturnType<typeof setTimeout>
    const cancelled = Symbol('cancelled'), timeout = Symbol('timeout')
    const boundary = new Promise<symbol>(resolve => {
      timer = setTimeout(() => resolve(timeout), this.options.historyTimeoutMilliseconds ?? 10000)
      this.cancelHistoryRead = () => { clearTimeout(timer); resolve(cancelled) }
    })
    this.historyTask = Promise.race([Promise.resolve().then(() => this.disposed || generation !== this.historyGeneration ? cancelled : this.options.readHistory!()), boundary]).then(raw => {
      if (this.disposed || generation !== this.historyGeneration || raw === cancelled) return
      if (raw === timeout) throw new Error('timeout')
      this.history = parseTyporaRecent(raw, this.host.platform)
      this.historyError = this.history.status === 'ready' ? undefined : this.history.message
    }).catch(error => {
      if (this.disposed || generation !== this.historyGeneration) return
      this.history = normalizeHistory(undefined, this.host.platform)
      this.historyError = error instanceof Error && error.message === 'timeout' ? 'Reading Typora\'s Recent list timed out. It will retry.' : 'Could not read Typora\'s Recent list. It will retry.'
    }).finally(() => {
      clearTimeout(timer)
      if (generation !== this.historyGeneration) return
      this.historyTask = undefined; this.cancelHistoryRead = undefined; this.historyReadAt = Date.now()
      // An unchanged list is not republished, so background reads never disturb the panel.
      if (firstRead || JSON.stringify([this.history, this.historyError]) !== before) this.publish()
    })
    if (firstRead) this.publish()
    return this.historyTask
  }

  change(operation: FavoritesOperation) { return this.collection.change(operation) }
  commit(draft: FavoritesDraft) { return this.collection.commit(draft) }
  open(kind: LocationKind, path: string, options?: OpenOptions) { return this.navigate('open', kind, path, options) }
  reveal(kind: LocationKind, path: string) { return this.navigate('reveal', kind, path) }

  private async navigate(action: 'open' | 'reveal', kind: LocationKind, path: string, options?: OpenOptions): Promise<void> {
    if (this.disposed) return
    const generation = ++this.actionGeneration
    try {
      await (action === 'open' ? this.host.open(kind, path, options) : this.host.reveal(kind, path))
      if (this.disposed || generation !== this.actionGeneration) return
      this.actionError = undefined; this.failedTarget = undefined
    } catch (error) {
      if (this.disposed || generation !== this.actionGeneration) return
      try {
        this.failedTarget = locationId(kind, path, this.host.platform)
        this.unavailable.add(this.failedTarget)
      } catch { this.failedTarget = undefined }
      this.actionError = error instanceof Error ? error.message : 'The location could not be opened. Your Favorite is preserved.'
    }
    this.publish()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.historyGeneration++; this.cancelHistoryRead?.(); this.cancelHistoryRead = undefined; this.historyTask = undefined
    this.history = normalizeHistory(undefined, this.host.platform); this.historyError = undefined
    this.disposers.splice(0).forEach(dispose => dispose())
    this.host.dispose?.()
    this.listeners.clear()
    this.collection.dispose()
  }
}
