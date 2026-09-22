import { Modal, SettingTab } from '@typora-community-plugin/core'
import type { QuickAccessController } from './controller'
import { renderSettings } from './settings-ui'

function bindSettings(container: HTMLElement, controller: QuickAccessController) {
  let disposeEditor = () => {}; let previous = ''
  const status = document.createElement('p'); status.setAttribute('role', 'alert')
  const editor = document.createElement('div'); container.replaceChildren(editor, status)
  const unsubscribe = controller.subscribe(snapshot => {
    status.textContent = snapshot.error || ''; status.hidden = !snapshot.error
    const next = `${snapshot.state.preferences.recentFiles}:${snapshot.state.preferences.recentFolders}`
    if (previous === next) return
    previous = next; disposeEditor()
    disposeEditor = renderSettings(editor, snapshot.state, patch => controller.change({ type: 'preferences', patch }))
  })
  return () => { unsubscribe(); disposeEditor(); container.replaceChildren() }
}

export class QuickAccessSettingTab extends SettingTab {
  get name() { return 'Quick Access' }
  private detach?: () => void
  constructor(private controller: QuickAccessController) { super() }
  onshow() { this.detach?.(); this.detach = bindSettings(this.containerEl, this.controller) }
  onhide() { this.detach?.(); this.detach = undefined }
  dispose() { this.onhide(); this.containerEl.remove() }
}

export function openSettings(controller: QuickAccessController, onClose: () => void): Modal {
  let detach = () => {}; let closed = false
  const modal = new Modal({ className: 'qa-settings-modal' }).setHeader('Quick Access settings')
    .setBody(body => { detach = bindSettings(body, controller) })
    .onClose(() => {
      if (closed) return
      closed = true; detach()
      // Core close() only hides its wrapper. jQuery remove also releases the
      // core's click/keyup handlers and descendant data before dropping the DOM.
      $(modal.containerEl).remove()
      onClose()
    })
  modal.open(); return modal
}
