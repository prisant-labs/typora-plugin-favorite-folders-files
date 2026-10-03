import { SettingTab } from '@typora-community-plugin/core'
import type { FavoritesController } from './controller'
import { renderSettings, type SettingsMetadata } from './settings-ui'
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
}

function bindSettings(container: HTMLElement, controller: FavoritesController, options: FavoritesSettingTabOptions) {
  const { recentAvailable: readRecent, subscribeRecent, updates: source, ...metadata } = options
  let disposeEditor = () => {}; let previous = ''; let disposed = false
  const status = document.createElement('p'); status.setAttribute('role', 'alert')
  // The host lets the settings page, and so its preview, fill Core's pane height.
  const editor = document.createElement('div'); editor.className = 'qa-settings-host'; container.replaceChildren(editor, status)
  const render = () => {
    if (disposed) return
    const state = controller.state, error = controller.error, recentAvailable = readRecent?.() ?? false
    const update = source?.state()
    status.textContent = error || ''; status.hidden = !error
    const next = JSON.stringify([state.preferences, controller.writable, recentAvailable, update ?? null])
    if (previous === next) return
    const active = document.activeElement
    const focused = active instanceof HTMLElement && editor.contains(active)
      ? active.dataset.settingKey
      : active === document.body ? editor.querySelector<HTMLElement>('[data-restore-focus="true"]')?.dataset.settingKey : undefined
    previous = next; disposeEditor()
    disposeEditor = renderSettings(editor, state, patch => controller.change({ type: 'favorites:preferences', patch }), {
      ...metadata, writable: controller.writable, recentAvailable,
      update: source && update?.version ? { version: update.version, open: () => source.open() } : undefined,
      updates: source && update ? { enabled: update.enabled, setEnabled: enabled => source.setEnabled(enabled) } : undefined,
    })
    if (focused) {
      const replacement = Array.from(editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting-key]')).find(input => input.dataset.settingKey === focused)
      if (replacement && !replacement.disabled) replacement.focus()
    }
  }
  const unsubscribe = controller.subscribe(render)
  const unsubscribeRecent = subscribeRecent?.(render)
  const unsubscribeUpdates = source?.subscribe(render)
  source?.check()
  return () => { disposed = true; unsubscribe(); unsubscribeRecent?.(); unsubscribeUpdates?.(); disposeEditor(); container.replaceChildren() }
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
