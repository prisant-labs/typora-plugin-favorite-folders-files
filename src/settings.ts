import { SettingTab } from '@typora-community-plugin/core'
import type { FavoritesController } from './controller'
import { renderSettings, type RecentSnapshotActions, type RecentSnapshotStatus, type SettingsMetadata } from './settings-ui'

export interface FavoritesSettingTabOptions extends SettingsMetadata, RecentSnapshotActions {
  recentAvailable?: () => boolean
  recentStatus?: () => RecentSnapshotStatus
  subscribeRecent?: (listener: () => void) => () => void
}

const focusKey = (node?: Element | null) => node instanceof HTMLElement ? node.dataset.settingKey ?? node.dataset.action : undefined

function bindSettings(container: HTMLElement, controller: FavoritesController, options: FavoritesSettingTabOptions) {
  let disposeEditor = () => {}; let previous = ''; let disposed = false
  // A control disabled mid-action (Importing…) gets focus back on the next rebuild.
  let pendingFocus: string | undefined
  const status = document.createElement('p'); status.setAttribute('role', 'alert')
  // The host lets the settings page, and so its preview, fill Core's pane height.
  const editor = document.createElement('div'); editor.className = 'qa-settings-host'; container.replaceChildren(editor, status)
  const render = () => {
    if (disposed) return
    const state = controller.state, error = controller.error, recentAvailable = options.recentAvailable?.() ?? false, recent = options.recentStatus?.()
    status.textContent = error || ''; status.hidden = !error
    const next = JSON.stringify([state.preferences, controller.writable, recentAvailable, recent])
    if (previous === next) return
    const active = document.activeElement
    const focused = active instanceof HTMLElement && editor.contains(active)
      ? focusKey(active)
      : active === document.body ? focusKey(editor.querySelector('[data-restore-focus="true"]')) ?? pendingFocus : undefined
    previous = next; pendingFocus = undefined; disposeEditor()
    disposeEditor = renderSettings(editor, state, patch => controller.change({ type: 'favorites:preferences', patch }), { ...options, writable: controller.writable, recentAvailable, recent })
    if (focused) {
      const replacement = Array.from(editor.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('select[data-setting-key], button[data-action]')).find(node => focusKey(node) === focused)
      if (replacement && !replacement.disabled) replacement.focus(); else pendingFocus = focused
    }
  }
  const unsubscribe = controller.subscribe(render)
  const unsubscribeRecent = options.subscribeRecent?.(render)
  return () => { disposed = true; unsubscribe(); unsubscribeRecent?.(); disposeEditor(); container.replaceChildren() }
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
