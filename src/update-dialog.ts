import { Modal } from '@typora-community-plugin/core'
import { buildUpdateConfirmation, type UpdateConfirmationOptions } from './update-confirmation'

/** Asks before Core updates Favorites. The plugin's unload closes it, including the unload Core performs during the update. */
export function openUpdateConfirmation(options: Omit<UpdateConfirmationOptions, 'close' | 'isOpen'>): { close(): void } {
  let closed = false
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const modal = new Modal({ className: 'qa-update-dialog' })
  const close = () => { if (!closed) modal.close() }
  const body = buildUpdateConfirmation({ ...options, close, isOpen: () => !closed })
  modal.setHeader('Update Favorites')
  modal.setBody(container => container.append(body))
  modal.onClose(() => {
    closed = true
    // Core's close only hides its wrapper; each confirmation is new, so drop the old one.
    ;(modal as unknown as { containerEl?: HTMLElement }).containerEl?.remove()
    if (opener?.isConnected) opener.focus()
  })
  modal.open()
  // Focus inside the dialog: Core closes it on Escape only from within, and Enter must not reach the opener.
  body.querySelector<HTMLButtonElement>('[data-action="cancel-update"]')?.focus()
  return { close }
}
