import { createState, locationId, normalizePath, type LocationKind, type Operation, type State } from './model'
import { isMarkdown, type Host } from './host'
import type { PanelSnapshot } from './panel'

export interface StateStore { read(): Promise<State>; update(operation: Operation): Promise<State>; close(): Promise<void> }
interface Options { collectHistory?: boolean; pollMilliseconds?: number; now?: () => number }

/** Serial reads/writes prevent a slow refresh from overwriting a newer operation. */
export class QuickAccessController {
  snapshot: PanelSnapshot
  private queue = Promise.resolve()
  private listeners = new Set<(snapshot: PanelSnapshot) => void>()
  private disposers: (() => void)[] = []
  private disposed = false
  private started = false
  private writable = false
  private storageError?: string
  private actionError?: string
  private unavailable = new Set<string>()
  private observed: Partial<Record<LocationKind, string>> = {}
  constructor(private host: Host, private store: StateStore, private options: Options = {}) {
    this.snapshot = { state: createState(), platform: host.platform, current: {} }
  }
  subscribe(listener: (snapshot: PanelSnapshot) => void) {
    if (this.disposed) return () => {}
    this.listeners.add(listener); listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }
  private publish() {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, unavailable: new Set(this.unavailable), error: this.storageError || this.actionError }
    this.listeners.forEach(listener => listener(this.snapshot))
  }
  private enqueue(work: () => Promise<void>) {
    this.queue = this.queue.then(async () => { if (!this.disposed) await work() }).catch(() => {
      // All normal failures have contextual handlers. Keep the queue alive if an observer fails.
      this.storageError = 'Quick Access could not complete the operation. Reopen the plugin to retry.'
      this.writable = false
    })
    return this.queue
  }
  async idle() { let pending; do { pending = this.queue; await pending } while (pending !== this.queue) }
  async start() {
    if (this.started || this.disposed) return
    this.started = true
    this.disposers.push(this.host.subscribe(() => this.observe()))
    if (typeof window !== 'undefined') {
      const refresh = () => { void this.refresh() }
      const visible = () => { if (!document.hidden) refresh() }
      window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible)
      this.disposers.push(() => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible) })
    }
    if ((this.options.pollMilliseconds ?? 2000) > 0) {
      const timer = setInterval(() => { void this.refresh() }, this.options.pollMilliseconds ?? 2000)
      this.disposers.push(() => clearInterval(timer))
    }
    await this.refresh(); await this.idle()
  }
  refresh() {
    return this.enqueue(async () => {
      try {
        const state = await this.store.read()
        if (this.disposed) return
        this.snapshot = { ...this.snapshot, state }; this.writable = true; this.storageError = undefined
      } catch {
        if (this.disposed) return
        this.writable = false; this.storageError = 'Quick Access storage could not be read. Changes are disabled to protect saved locations.'
      }
      this.observe(); this.publish()
    })
  }
  private observe() {
    if (this.disposed) return
    const actual = this.host.current()
    const current: PanelSnapshot['current'] = {}
    for (const kind of ['folder', 'file'] as const) {
      try {
        const path = actual[kind]
        if (!path || (kind === 'file' && !isMarkdown(path))) { this.observed[kind] = undefined; continue }
        const normalized = normalizePath(path, this.host.platform)
        const identity = locationId(kind, normalized, this.host.platform)
        current[kind] = normalized
        this.unavailable.delete(identity)
        if (this.observed[kind] !== identity && this.writable && this.options.collectHistory !== false) {
          this.observed[kind] = identity
          void this.change({ type: 'visit', kind, path: normalized, at: (this.options.now ?? Date.now)() })
        }
      } catch { this.observed[kind] = undefined /* Unsaved or invalid host path. */ }
    }
    this.snapshot = { ...this.snapshot, current }; this.publish()
  }
  change(operation: Operation) {
    return this.enqueue(async () => {
      if (!this.writable) { this.publish(); return }
      try {
        const state = await this.store.update(operation)
        if (this.disposed) return
        this.snapshot = { ...this.snapshot, state }; this.storageError = undefined
      } catch {
        if (this.disposed) return
        this.writable = false; this.storageError = 'Quick Access storage could not be updated. Changes are disabled to protect saved locations.'
      }
      this.publish()
    })
  }
  async open(kind: LocationKind, path: string) { await this.navigate('open', kind, path) }
  async reveal(kind: LocationKind, path: string) { await this.navigate('reveal', kind, path) }
  private async navigate(action: 'open' | 'reveal', kind: LocationKind, path: string) {
    if (this.disposed) return
    try {
      await this.host[action](kind, path)
      if (this.disposed) return
      this.actionError = undefined
      // Only the actual host snapshot, observed through events/refresh, records a visit.
    } catch (error) {
      if (this.disposed) return
      try { this.unavailable.add(locationId(kind, path, this.host.platform)) } catch { /* Invalid path. */ }
      this.actionError = error instanceof Error ? error.message : 'The location could not be opened. Your pin is preserved.'
    }
    this.publish()
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.host.dispose?.()
    this.disposers.splice(0).forEach(dispose => dispose()); this.listeners.clear()
    void this.queue.finally(() => this.store.close()).catch(() => {})
  }
}
