import { Plugin, SidebarPanel, fs, type Modal } from '@typora-community-plugin/core'
import { QuickAccessController } from './controller'
import { NativeHost, type NativeServices } from './host'
import { IndexedDbStore } from './storage'
import { icon, QuickAccessPanelRenderer } from './panel'
import { openSettings, QuickAccessSettingTab } from './settings'
import './style.scss'

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
      invoke: (command, path) => bridge().invoke(command, path),
      showInFinder: path => bridge().showInFinder(path),
    })
    // The initial candidate can pin current locations; independent recent-history
    // collection remains off until the user resolves the history-source choice.
    const controller = new QuickAccessController(host, new IndexedDbStore(app.platform), { collectHistory: false })
    let disposed = false; let modal: Modal | undefined
    const settings = () => { if (!disposed && !modal) modal = openSettings(controller, () => { modal = undefined }) }
    // Fresh class per enable: core keeps a stale private activePanel after removal.
    class QuickAccessSidebarPanel extends SidebarPanel {
      show() { if (!disposed) super.show() }
    }
    const panel = new QuickAccessSidebarPanel(app.workspace.ribbon, app.workspace.sidebar)
    panel.containerEl = document.createElement('div')
    const ribbonIcon = document.createElement('span'); ribbonIcon.append(icon('bookmark'))
    panel.addRibbonButton({ id: 'prisant-labs.quick-access', title: 'Quick Access', icon: ribbonIcon })
    const renderer = new QuickAccessPanelRenderer(panel.containerEl, {
      change: operation => controller.change(operation), open: (kind, path) => controller.open(kind, path),
      reveal: (kind, path) => controller.reveal(kind, path), settings,
    })
    const unsubscribe = controller.subscribe(snapshot => renderer.update(snapshot))
    const removePanel = app.workspace.sidebar.addPanel(panel)
    const tab = new QuickAccessSettingTab(controller); this.registerSettingTab(tab)
    this.registerCommand({ id: 'toggle', title: 'Toggle panel', scope: 'global', callback: () => { if (!disposed) app.workspace.sidebar.switch(QuickAccessSidebarPanel) } })
    this.registerCommand({ id: 'settings', title: 'Settings', scope: 'global', callback: settings })
    const cleanup = () => {
      if (disposed) return
      disposed = true; modal?.close(); tab.dispose(); unsubscribe(); controller.dispose()
      renderer.dispose(); panel.hide(); panel.containerEl.remove(); removePanel()
    }
    this.cleanup = cleanup; this.register(cleanup)
    void controller.start()
  }
  onunload(): void { this.cleanup?.(); this.cleanup = undefined }
}
