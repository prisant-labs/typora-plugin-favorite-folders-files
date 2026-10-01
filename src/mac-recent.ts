/** Typora's macOS WebKit bridge. `setting.getRecentFiles` exists only on its Electron branch. */
export interface MacBridge { callHandler(name: string, ...args: unknown[]): unknown }
/** Typora's Quick Open panel (`File.editor.quickOpenPanel`), which receives the macOS Recent files list. */
export interface QuickOpenPanel { setRecentFiles(paths: unknown): unknown; initFileCache?(...args: unknown[]): unknown }
export interface MacRecentServices { bridge(): MacBridge | undefined; quickOpen(): QuickOpenPanel | undefined }
/** The Windows getter's `{ files, folders }` shape, so `parseTyporaRecent` stays the only validator. */
export interface MacRecentPayload { files: unknown; folders: unknown }

type Method = (...args: unknown[]) => unknown
interface Hook { name: string; wrapper: Method; hadOwn: boolean; previous?: Method }

/**
 * Quick Open methods that replace the whole Recent files list, and where each one carries it.
 * `initFileCache(paths, names, dates, total, recentFiles)` indexes a folder and sets the list
 * only when its fifth argument is given. `updateCache` edits one entry and is not a full list.
 */
const LIST_METHODS: Record<string, (args: unknown[]) => unknown> = {
  setRecentFiles: args => args[0],
  initFileCache: args => args[4] || undefined,
}

/**
 * Reads Typora's macOS Recent list through the two channels its own page code uses:
 * folders from `library.getRecentFolders` (the sidebar folder menu), and files from the
 * list the macOS app sends Quick Open after `quickOpen.cacheRecentFiles`. Typora offers no
 * call that returns the files, so a read observes Quick Open through pass-through wrappers.
 * Nothing is kept between reads.
 */
export class MacRecentReader {
  private disposed = false
  private observed?: { panel: QuickOpenPanel; hooks: Hook[] }
  private readonly waiters = new Set<(paths: unknown) => void>()
  private readonly pending = new Set<(error: Error) => void>()

  constructor(private readonly services: MacRecentServices, private readonly options: { timeoutMilliseconds?: number } = {}) {}

  private channels(): { bridge: MacBridge; panel: QuickOpenPanel } | undefined {
    if (this.disposed) return undefined
    try {
      const bridge = this.services.bridge(), panel = this.services.quickOpen()
      if (typeof bridge?.callHandler === 'function' && typeof panel?.setRecentFiles === 'function') return { bridge, panel }
    } catch { /* A Typora build without these internals has no macOS Recent. */ }
    return undefined
  }

  available(): boolean { return Boolean(this.channels()) }

  read(): Promise<MacRecentPayload> {
    if (this.disposed) return Promise.reject(new Error('disposed'))
    const channels = this.channels()
    if (!channels) return Promise.reject(new Error('unavailable'))
    return new Promise<MacRecentPayload>((resolve, reject) => {
      let files: unknown, folders: unknown, haveFiles = false, haveFolders = false, settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: Error) => {
        if (settled) return
        settled = true; clearTimeout(timer); this.waiters.delete(onFiles); this.pending.delete(finish)
        if (error) reject(error)
        else resolve({ files: Array.isArray(files) ? files.map(path => ({ path })) : files, folders })
      }
      const onFiles = (paths: unknown) => { files = paths; haveFiles = true; if (haveFolders) finish() }
      const onFolders = (rows: unknown) => { if (settled) return; folders = rows; haveFolders = true; if (haveFiles) finish() }
      // Observe and wait before asking: the macOS app may send the list during the request itself.
      this.observe(channels.panel)
      this.waiters.add(onFiles); this.pending.add(finish)
      timer = setTimeout(() => finish(new Error('timeout')), this.options.timeoutMilliseconds ?? 5000)
      try {
        channels.bridge.callHandler('library.getRecentFolders', onFolders)
        channels.bridge.callHandler('quickOpen.cacheRecentFiles')
      } catch { finish(new Error('bridge')) }
    })
  }

  /** Hooks each panel instance once. A script that later wraps over a hook keeps it in its chain. */
  private observe(panel: QuickOpenPanel) {
    if (this.observed?.panel === panel) return
    this.restore()
    const target = panel as unknown as Record<string, unknown>
    const hooks: Hook[] = []
    for (const [name, list] of Object.entries(LIST_METHODS)) {
      if (typeof target[name] !== 'function') continue
      const hadOwn = Object.prototype.hasOwnProperty.call(panel, name)
      const previous = hadOwn ? target[name] as Method : undefined
      const reader = this
      const wrapper = function (this: unknown, ...args: unknown[]) {
        if (!reader.disposed && reader.observed?.panel === panel) { const paths = list(args); if (paths !== undefined) reader.deliver(paths) }
        // Without an own method, Typora's is looked up per call, so later prototype patches still run.
        const method = (previous ?? (Object.getPrototypeOf(panel) as Record<string, unknown>)[name]) as Method
        return method.apply(this, args)
      }
      target[name] = wrapper
      hooks.push({ name, wrapper, hadOwn, previous })
    }
    this.observed = { panel, hooks }
  }

  private deliver(paths: unknown) {
    try {
      const copy = Array.isArray(paths) ? [...paths] : paths
      for (const waiter of [...this.waiters]) waiter(copy)
    } catch { /* Quick Open must receive its list whatever happens here. */ }
  }

  /** Puts Quick Open back as it was, except where another script has since wrapped over a hook. */
  private restore() {
    const observed = this.observed
    this.observed = undefined
    if (!observed) return
    const target = observed.panel as unknown as Record<string, unknown>
    for (const hook of observed.hooks) {
      try {
        if (target[hook.name] !== hook.wrapper) continue
        if (hook.hadOwn) target[hook.name] = hook.previous
        else delete target[hook.name]
      } catch { /* A frozen panel keeps the wrapper, which then only forwards. */ }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const fail of [...this.pending]) fail(new Error('disposed'))
    this.restore()
  }
}
