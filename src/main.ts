import { Plugin, SidebarPanel, fs } from '@typora-community-plugin/core'
import { FavoritesController } from './controller'
import { FavoritesRuntime } from './favorites-runtime'
import { FavoritesPanelRenderer } from './favorites-panel'
import { NativeHost, type NativeServices } from './host'
import { FavoritesIndexedDbStore } from './storage'
import { favoritesRibbonIcon } from './panel'
import { openSettings, QuickAccessSettingTab } from './settings'
import './style.scss'
import './settings.scss'

export default class QuickAccessPlugin extends Plugin {
  private cleanup?: () => void
  onload(): void {
    this.cleanup?.()
    const app = this.app
    const bridge = () => {
      const native = (globalThis as unknown as { JSBridge?: Pick<NativeServices, 'invoke' | 'showInFinder'> }).JSBridge
      if (!native) throw new Error('Native navigation is unavailable in this Typora window.')
      return native
    }
    const host = new NativeHost(app, {
      stat: path => fs.stat(path),
      isDirectory: path => fs.isDirectory(path),
      invoke: (command, ...args) => bridge().invoke(command, ...args),
      showInFinder: path => bridge().showInFinder(path),
    })
    const collection = new FavoritesController(new FavoritesIndexedDbStore(app.platform), app.platform)
    const container = document.createElement('div')
    const runtime = new FavoritesRuntime(host, collection, {
      readHistory: app.platform === 'win32' ? async () => bridge().invoke('setting.getRecentFiles') : undefined,
      isVisible: () => container.isConnected && container.getClientRects().length > 0,
    })
    let disposed = false
    const settings = () => { if (!disposed) return openSettings(app) }
    // Fresh class per enable: core keeps a stale private activePanel after removal.
    class QuickAccessSidebarPanel extends SidebarPanel {
      show() { if (!disposed) { super.show(); void runtime.syncHistory(true) } }
    }
    const panel = new QuickAccessSidebarPanel(app.workspace.ribbon, app.workspace.sidebar)
    panel.containerEl = container
    const ribbonIcon = document.createElement('span'); ribbonIcon.append(favoritesRibbonIcon())
    panel.addRibbonButton({ id: this.manifest.id, title: 'Favorites', icon: ribbonIcon })
    const renderer = new FavoritesPanelRenderer(panel.containerEl, {
      change: operation => runtime.change(operation), commit: draft => runtime.commit(draft), open: (kind, path, options) => runtime.open(kind, path, options),
      reveal: (kind, path) => runtime.reveal(kind, path), settings: () => Promise.resolve(settings()),
    })
    const unsubscribe = runtime.subscribe(snapshot => renderer.update(snapshot))
    const removePanel = app.workspace.sidebar.addPanel(panel)
    const tab = new QuickAccessSettingTab(collection, {
      version: this.manifest.version, author: this.manifest.author, authorUrl: this.manifest.authorUrl, repo: this.manifest.repo,
      openFolder: this.manifest.dir ? async () => { await bridge().invoke('shell.openItem', this.manifest.dir) } : undefined,
      recentAvailable: () => runtime.snapshot.history.status === 'ready' && runtime.snapshot.history.order !== 'per-kind',
      subscribeRecent: listener => runtime.subscribe(() => listener()),
    }); this.registerSettingTab(tab)
    this.registerCommand({ id: 'toggle', title: 'Toggle panel', scope: 'global', callback: () => { if (!disposed) app.workspace.sidebar.switch(QuickAccessSidebarPanel) } })
    this.registerCommand({ id: 'settings', title: 'Settings', scope: 'global', callback: () => { settings() } })
    const cleanup = () => {
      if (disposed) return
      disposed = true; tab.dispose(); unsubscribe(); runtime.dispose()
      renderer.dispose(); panel.hide(); panel.containerEl.remove(); removePanel()
    }
    this.cleanup = cleanup; this.register(cleanup)
    void runtime.start()
  }
  onunload(): void { this.cleanup?.(); this.cleanup = undefined }
}
