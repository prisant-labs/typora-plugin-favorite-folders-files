import { createFavoritesState, createState, locationId, normalizePath, validateFavoritesState, type FavoritesOperation, type FavoritesState, type LocationKind, type Operation, type Platform, type State } from './model'
import { isMarkdown, type Host } from './host'
import type { PanelSnapshot } from './panel'
import { cloneFavoritesDraft, cloneFavoritesOperation, FavoritesDraftSession, type FavoritesDraft } from './editor-state'

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

export interface FavoritesStateStore {
  read(): Promise<FavoritesState>
  update(operation: FavoritesOperation): Promise<FavoritesState>
  commitDraft(draft: FavoritesDraft): Promise<FavoritesState>
  close(): Promise<void>
}

/** Host-independent, serialized boundary for confirmed Favorites state. */
export class FavoritesController {
  private current = createFavoritesState()
  error?: string
  private ready = false
  private hasConfirmed = false
  private disposed = false
  private starting?: Promise<void>
  private queue: Promise<void> = Promise.resolve()
  private pending = 0
  private listeners = new Set<(state: FavoritesState, error?: string) => void>()
  private commits = new WeakMap<FavoritesDraft, Promise<FavoritesState>>()

  constructor(private readonly store: FavoritesStateStore, private readonly platform: Platform) {}

  get state(): FavoritesState { return validateFavoritesState(this.current, this.platform) }
  get writable(): boolean { return this.ready && !this.disposed }

  subscribe(listener: (state: FavoritesState, error?: string) => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    this.notify(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(listener: (state: FavoritesState, error?: string) => void): void {
    try { listener(this.state, this.error) } catch { /* Observers cannot undo a confirmed write or stop other observers. */ }
  }

  private publish(): void {
    if (this.disposed) return
    for (const listener of this.listeners) this.notify(listener)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Favorites controller is disposed'))
    const run = () => {
      if (this.disposed) throw new Error('Favorites controller is disposed')
      return work()
    }
    let result: Promise<T>
    try { result = this.pending === 0 ? run() : this.queue.then(run) }
    catch (error) { result = Promise.reject(error) }
    this.pending += 1
    this.queue = result.then(() => {}, () => {}).then(() => { this.pending -= 1 })
    return result
  }

  async idle(): Promise<void> {
    while (this.pending > 0) await this.queue
  }

  start(): Promise<void> {
    if (this.disposed || this.ready) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = this.refresh().finally(() => { this.starting = undefined })
    return this.starting
  }

  private confirm(value: FavoritesState): FavoritesState {
    const saved = validateFavoritesState(value, this.platform)
    if (saved.revision < this.current.revision || (saved.revision === this.current.revision && this.hasConfirmed && JSON.stringify(saved) !== JSON.stringify(this.current))) {
      throw new Error('Favorites saved revision does not match the last confirmed state')
    }
    if (!this.disposed) {
      this.current = saved
      this.ready = true
      this.hasConfirmed = true
      this.error = undefined
      this.publish()
    }
    return validateFavoritesState(saved, this.platform)
  }

  refresh(): Promise<void> {
    return this.enqueue(async () => {
      try {
        const saved = await this.store.read()
        if (!this.disposed) this.confirm(saved)
      } catch (error) {
        if (!this.disposed) {
          this.ready = false
          this.error = error instanceof Error ? error.message : 'Favorites storage could not be read'
          this.publish()
        }
        throw error
      }
    })
  }

  beginDraft(): FavoritesDraftSession {
    if (!this.writable) throw new Error('Favorites is not ready for editing')
    return new FavoritesDraftSession(this.state, this.platform)
  }

  private mutate(work: () => Promise<FavoritesState>): Promise<FavoritesState> {
    if (!this.writable) return Promise.reject(new Error('Favorites is not ready for changes'))
    return this.enqueue(async () => {
      if (!this.writable) throw new Error('Favorites is not ready for changes')
      try { return this.confirm(await work()) }
      catch (error) {
        if (!this.disposed) {
          this.error = error instanceof Error ? error.message : 'Favorites could not be saved'
          this.publish()
        }
        throw error
      }
    })
  }

  change(operation: FavoritesOperation): Promise<FavoritesState> {
    const captured = cloneFavoritesOperation(operation)
    return this.mutate(() => this.store.update(captured))
  }

  commit(draft: FavoritesDraft): Promise<FavoritesState> {
    const pending = this.commits.get(draft)
    if (pending) return pending
    const captured = cloneFavoritesDraft(draft)
    const saved = this.mutate(() => this.store.commitDraft(captured))
    this.commits.set(draft, saved)
    void saved.then(() => { this.commits.delete(draft) }, () => { this.commits.delete(draft) })
    return saved
  }

  saveDraft(session: FavoritesDraftSession): Promise<FavoritesState> {
    if (!this.writable) return Promise.reject(new Error('Favorites is not ready for changes'))
    return session.save(draft => this.commit(draft))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
    void this.idle().then(() => this.store.close()).catch(() => {})
  }
}
