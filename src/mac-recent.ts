/** Typora's macOS WebKit bridge. `setting.getRecentFiles` exists only on its Electron branch. */
export interface MacBridge { callHandler(name: string, ...args: unknown[]): unknown }
/** Typora's Quick Open panel (`File.editor.quickOpenPanel`), which receives the macOS Recent files list. */
export interface QuickOpenPanel { setRecentFiles(paths: unknown): unknown }
export interface MacRecentServices { bridge(): MacBridge | undefined; quickOpen(): QuickOpenPanel | undefined }
/** The Windows getter's `{ files, folders }` shape, so `parseTyporaRecent` stays the only validator. */
export interface MacRecentPayload { files: unknown; folders: unknown }

interface Observed {
  panel: QuickOpenPanel
  wrapper: QuickOpenPanel['setRecentFiles']
  hadOwn: boolean
  previous?: QuickOpenPanel['setRecentFiles']
}

/**
 * Reads Typora's macOS Recent list through the two channels its own page code uses:
 * folders from `library.getRecentFolders` (the sidebar folder menu), and files from the
 * list the macOS app sends Quick Open after `quickOpen.cacheRecentFiles`. Typora offers no
 * call that returns the files, so a read observes Quick Open's `setRecentFiles` through a
 * pass-through wrapper. Nothing is kept between reads.
 */
export class MacRecentReader {
  private disposed = false
  private observed?: Observed
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

  private observe(panel: QuickOpenPanel) {
    if (this.observed?.panel === panel && panel.setRecentFiles === this.observed.wrapper) return
    // A replaced panel, or a script that wrapped over ours: release the old hook, then wrap what is current.
    this.restore()
    const hadOwn = Object.prototype.hasOwnProperty.call(panel, 'setRecentFiles')
    const original = panel.setRecentFiles
    const reader = this
    const wrapper = function (this: unknown, ...args: unknown[]) {
      if (!reader.disposed && reader.observed?.wrapper === wrapper) reader.deliver(args[0])
      return original.apply(this, args as [unknown])
    }
    panel.setRecentFiles = wrapper
    this.observed = { panel, wrapper, hadOwn, previous: hadOwn ? original : undefined }
  }

  private deliver(paths: unknown) {
    try {
      const copy = Array.isArray(paths) ? [...paths] : paths
      for (const waiter of [...this.waiters]) waiter(copy)
    } catch { /* Quick Open must receive its list whatever happens here. */ }
  }

  /** Puts Quick Open back as it was, unless another script has since wrapped over this hook. */
  private restore() {
    const observed = this.observed
    this.observed = undefined
    if (!observed) return
    try {
      if (observed.panel.setRecentFiles !== observed.wrapper) return
      if (observed.hadOwn) observed.panel.setRecentFiles = observed.previous!
      else delete (observed.panel as Partial<QuickOpenPanel>).setRecentFiles
    } catch { /* A frozen or replaced panel keeps the wrapper, which then only forwards. */ }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const fail of [...this.pending]) fail(new Error('disposed'))
    this.restore()
  }
}
