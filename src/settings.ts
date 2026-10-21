import { SettingTab } from '@typora-community-plugin/core'
import type { BrowseRootsChange } from './browse-runtime'
import type { PanelTab } from './browse-store'
import type { FavoritesController } from './controller'
import type { FolderChooser } from './folder-chooser'
import type { Platform } from './model'
import { renderSettings, type BrowseSettingError, type SettingsMetadata } from './settings-ui'
import type { UpdateState } from './update-check'

export interface FavoritesSettingTabOptions extends SettingsMetadata {
  recentAvailable?: () => boolean
  subscribeRecent?: (listener: () => void) => () => void
  /** The window's update notifier, as the settings page needs it. */
  updates?: {
    state(): UpdateState
    subscribe(listener: () => void): () => void
    open(): void
    setEnabled(enabled: boolean): Promise<unknown>
    check(): void
  }
  /** The panel's tab order, which Browse's record keeps. */
  tabs?: {
    state(): { order: readonly PanelTab[]; writable: boolean }
    subscribe(listener: () => void): () => void
    setOrder(order: PanelTab[]): Promise<unknown>
  }
  /** Browse's roots and its Home and Drives choices, which Browse's record keeps. */
  browse?: {
    platform: Platform
    state(): BrowseRootsChange & { writable: boolean }
    subscribe(listener: () => void): () => void
    save(change: BrowseRootsChange): Promise<unknown>
    /** The folder Typora has open. */
    current(): string | undefined
    choose?: FolderChooser
  }
}

function bindSettings(container: HTMLElement, controller: FavoritesController, options: FavoritesSettingTabOptions) {
  const { recentAvailable: readRecent, subscribeRecent, updates: source, tabs, browse, ...metadata } = options
  let disposeEditor = () => {}; let previous = ''; let disposed = false
  // A failed tab order or Browse save undoes itself by redrawing the page, so its message, and a typed root path, are kept out here.
  let tabsError = '', rootInput = ''
  let browseError: BrowseSettingError | undefined
  const status = document.createElement('p'); status.setAttribute('role', 'alert')
  // The host lets the settings page, and so its preview, fill Core's pane height.
  const editor = document.createElement('div'); editor.className = 'qa-settings-host'; container.replaceChildren(editor, status)
  const render = () => {
    if (disposed) return
    const state = controller.state, error = controller.error, recentAvailable = readRecent?.() ?? false
    const update = source?.state(), order = tabs?.state(), roots = browse?.state(), current = browse?.current()
    // Only a storage-wide problem shows at the top; each setting shows its own message in its row.
    status.textContent = error || ''; status.hidden = !status.textContent
    const next = JSON.stringify([state.preferences, controller.writable, recentAvailable, update ?? null, order ?? null, tabsError, roots ?? null, current ?? null, browseError ?? null])
    if (previous === next) return
    const active = document.activeElement
    const restoring = active instanceof HTMLElement && editor.contains(active)
      ? active
      : active === document.body ? editor.querySelector<HTMLElement>('[data-restore-focus="true"]') ?? undefined : undefined
    const focused = restoring?.dataset.settingKey, fallback = restoring?.dataset.settingFallback
    previous = next; disposeEditor()
    disposeEditor = renderSettings(editor, state, patch => controller.change({ type: 'favorites:preferences', patch }), {
      ...metadata, writable: controller.writable, recentAvailable,
      update: source && update?.version ? { version: update.version, open: () => source.open() } : undefined,
      updates: source && update ? { enabled: update.enabled, setEnabled: enabled => source.setEnabled(enabled) } : undefined,
      tabs: tabs && order ? {
        ...order, error: tabsError || undefined,
        setOrder: next => { tabsError = ''; return tabs.setOrder(next).catch(error => { tabsError = error instanceof Error ? error.message : 'The setting could not be saved.'; render() }) },
      } : undefined,
      browse: browse && roots ? {
        ...roots, platform: browse.platform, current, input: rootInput, error: browseError, choose: browse.choose,
        setInput: value => { rootInput = value },
        setError: (next, redraw = true) => { browseError = next; if (redraw) render() },
        save: change => browse.save(change),
      } : undefined,
    })
    if (focused) {
      const controls = Array.from(editor.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('[data-setting-key]'))
      const find = (key?: string) => controls.find(input => input.dataset.settingKey === key)
      // A control that is now disabled, or gone, hands focus to its fallback.
      let replacement = find(focused)
      if (!replacement || replacement.disabled) replacement = find(replacement?.dataset.settingFallback ?? fallback)
      if (replacement && !replacement.disabled) replacement.focus()
    }
  }
  const unsubscribe = controller.subscribe(render)
  const unsubscribeRecent = subscribeRecent?.(render)
  const unsubscribeUpdates = source?.subscribe(render)
  const unsubscribeTabs = tabs?.subscribe(render)
  const unsubscribeBrowse = browse?.subscribe(render)
  source?.check()
  return () => { disposed = true; unsubscribe(); unsubscribeRecent?.(); unsubscribeUpdates?.(); unsubscribeTabs?.(); unsubscribeBrowse?.(); disposeEditor(); container.replaceChildren() }
}

export class QuickAccessSettingTab extends SettingTab {
  get name() { return 'Favorites' }
  private detach?: () => void
  constructor(private controller: FavoritesController, private options: FavoritesSettingTabOptions = {}) { super() }
  onshow() { this.detach?.(); this.detach = bindSettings(this.containerEl, this.controller, this.options) }
  onhide() { this.detach?.(); this.detach = undefined }
  dispose() { this.onhide(); this.containerEl.remove() }
}

export function openSettings(app: { commands: { run(id: string, args: unknown[]): unknown } }): unknown {
  return app.commands.run('settings:open', [])
}
