import { normalizePath, type LocationKind, type Platform } from './model'

export interface Host {
  platform: Platform
  current(): { file?: string; folder?: string }
  subscribe(listener: () => void): () => void
  open(kind: LocationKind, path: string): Promise<void>
  reveal(kind: LocationKind, path: string): Promise<void>
  dispose?(): void
}
interface NativeApp {
  platform: Platform
  vault: { path: string; on(event: 'mounted' | 'change', listener: () => void): () => void }
  workspace: {
    activeFile: string
    activeEditor: { openFile(url: { pathname: string }): unknown }
    on(event: 'file:open' | 'active-leaf:change', listener: () => void): () => void
  }
  openFile(path: string): Promise<void>
}
export interface NativeServices {
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>
  invoke(command: string, path: string): unknown
  showInFinder(path: string): unknown
  isDirectory?(path: string): Promise<boolean>
}
export function isMarkdown(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkd|mkdn|mdwn|rmd|qmd)$/i.test(path)
}

/** The only boundary that dispatches native navigation. A dispatch is not a visit. */
export class NativeHost implements Host {
  readonly platform: Platform
  private disposed = false
  constructor(private app: NativeApp, private services: NativeServices) { this.platform = app.platform }
  current() {
    return { file: this.app.workspace.activeFile || undefined, folder: this.app.vault.path || undefined }
  }
  subscribe(listener: () => void) {
    const disposers = [
      this.app.workspace.on('file:open', listener), this.app.workspace.on('active-leaf:change', listener),
      this.app.vault.on('mounted', listener), this.app.vault.on('change', listener),
    ]
    return () => disposers.forEach(dispose => dispose())
  }
  private nativePath(path: string) {
    const normalized = normalizePath(path, this.platform)
    return this.platform === 'win32' ? normalized.replace(/\//g, '\\') : normalized
  }
  private async check(kind: LocationKind, path: string) {
    // Core 2.10.21 macOS stat/access interpolate paths into shell commands.
    // Dispatch the native request without those checks; Typora handles missing paths.
    if (this.platform === 'darwin') {
      if (kind === 'folder' && this.services.isDirectory && !(await this.services.isDirectory(path))) throw new Error('Unavailable folder. Your pin is preserved.')
      return
    }
    try {
      const info = await this.services.stat(path)
      if (kind === 'file' ? !info.isFile() : !info.isDirectory()) throw new Error('Wrong location kind')
    } catch { throw new Error(`Unavailable ${kind}. It may have moved or access may be denied. Your pin is preserved.`) }
  }
  async open(kind: LocationKind, path: string) {
    const nativePath = this.nativePath(path)
    if (kind === 'file' && !isMarkdown(nativePath)) throw new Error('Quick Access opens Markdown files only.')
    await this.check(kind, nativePath)
    if (this.disposed) return
    if (kind === 'folder') await this.services.invoke('controller.switchFolder', nativePath)
    else if (this.platform === 'darwin') {
      // app.openFile parses the path as a URL: #/? anywhere can truncate it,
      // misclassify it, and route into shell-based macOS fs.access. The public
      // editor method passes the validated pathname directly to native Typora.
      await this.app.workspace.activeEditor.openFile({ pathname: nativePath })
    } else await this.app.openFile(nativePath)
  }
  async reveal(kind: LocationKind, path: string) {
    const nativePath = this.nativePath(path)
    await this.check(kind, nativePath)
    if (this.disposed) return
    if (kind === 'folder') await this.services.invoke('shell.openItem', nativePath)
    else await this.services.showInFinder(nativePath)
  }
  dispose() { this.disposed = true }
}
