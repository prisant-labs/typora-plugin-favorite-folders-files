import { Modal } from '@typora-community-plugin/core'

async function copyText(area: HTMLTextAreaElement): Promise<boolean> {
  try { await navigator.clipboard.writeText(area.value); return true } catch { /* WebKit may refuse outside a gesture. */ }
  try { area.focus(); area.select(); return document.execCommand('copy') } catch { return false }
}

/** Shows the Recent diagnostics report in Core's modal, ready to copy. The report holds no paths. */
export function openRecentDiagnostics(run: () => Promise<string>): { close(): void } {
  let closed = false
  const modal = new Modal({ className: 'qa-diagnostics' })
  const intro = document.createElement('p')
  intro.textContent = 'This report shows how Favorites reads Typora\'s Recent list. It lists counts, kinds and timings, never paths or names.'
  const status = document.createElement('p'); status.className = 'qa-diagnostics__status'
  status.textContent = 'Reading Typora\'s Recent list…'
  const area = document.createElement('textarea'); area.readOnly = true; area.className = 'qa-diagnostics__report'
  const actions = document.createElement('div'); actions.className = 'qa-diagnostics__actions'
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy report'; copy.disabled = true
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'
  copy.addEventListener('click', () => { void copyText(area).then(copied => { copy.textContent = copied ? 'Copied' : 'Select the text and copy it' }) })
  close.addEventListener('click', () => modal.close())
  actions.append(copy, close)
  modal.setHeader('Favorites: Recent diagnostics')
  modal.setBody(body => body.append(intro, status, area, actions))
  modal.onClose(() => { closed = true })
  modal.open()
  void run().then(report => {
    if (closed) return
    area.value = report; status.textContent = 'Ready to copy.'; copy.disabled = false
    area.focus(); area.select()
  }, () => { if (!closed) status.textContent = 'The diagnostics could not run.' })
  return { close: () => { if (!closed) modal.close() } }
}
