import { applyOperation, createState, locationId, type LocationKind, type State } from '../src/model'
import { icon, QuickAccessPanelRenderer } from '../src/panel'
import { renderSettings } from '../src/settings-ui'

const mount = document.querySelector<HTMLElement>('#panel-mount')!
const status = document.querySelector<HTMLElement>('#host-status')!
let state: State
let current: { file?: string; folder?: string }
let unavailable = new Set<string>()
let error = ''
let disposeSettings = () => {}
const renderer = new QuickAccessPanelRenderer(mount, {
  change(operation) { state = applyOperation(state, operation, 'darwin'); render() },
  open(kind, path) {
    if (unavailable.has(locationId(kind, path, 'darwin'))) { error = 'This location is unavailable. Its pin has been kept.'; render(); return }
    if ((document.querySelector('#cancel-navigation') as HTMLInputElement).checked) {
      status.textContent = 'Simulated native cancellation: current location and history are unchanged.'; return
    }
    current[kind] = path
    state = applyOperation(state, { type: 'visit', kind, path, at: Date.now() }, 'darwin')
    status.textContent = `Simulated completed ${kind} visit. Native save/cancel is owned by Typora.`
    error = ''; render()
  },
  reveal(kind, path) { status.textContent = `Simulated Finder ${kind === 'file' ? 'reveal' : 'open'}: ${path}. No visit recorded.` },
  settings() { const settings = document.querySelector<HTMLDialogElement>('#settings-dialog')!; settings.showModal(); syncSettings() },
})
function render() {
  renderer.update({ state, current, unavailable, error, platform: 'darwin' })
  document.querySelector('#document-path')!.textContent = current.file || 'No document open'
}
function fixture(name: string) {
  state = createState(); unavailable = new Set(); error = ''
  current = { file: '/Projects/Field notes/Working notes.md', folder: '/Projects/Field notes' }
  if (name !== 'empty') {
    const locations: Array<[LocationKind, string, boolean]> = [
      ['folder', '/Projects/Field notes', true], ['folder', '/Projects/Atlas', true],
      ['folder', '/Library/Reference', true], ['folder', '/Projects/Archive', false],
      ['folder', '/Projects/Reading', false], ['file', '/Projects/Field notes/Working notes.md', true],
      ['file', '/Projects/Atlas/README.md', true], ['file', '/Projects/Field notes/README.md', false],
      ['file', '/Projects/Field notes/Ideas.md', false], ['file', '/Projects/Archive/Research.md', false],
    ]
    if (name === 'long') locations.push(['file', '/Projects/Field notes/日本語/Café and a deliberately long document name for narrow panels.md', true])
    locations.forEach(([kind, path, pinned], index) => {
      state = applyOperation(state, { type: 'visit', kind, path, at: 1000 - index }, 'darwin')
      if (pinned) state = applyOperation(state, { type: 'pin', kind, path, pinned: true }, 'darwin')
    })
    if (name === 'missing') unavailable.add(locationId('folder', '/Library/Reference', 'darwin'))
    if (name === 'long') state = applyOperation(state, { type: 'preferences', patch: { tab: 'file' } }, 'darwin')
  }
  status.textContent = 'Synthetic data. The panel uses the production renderer, model and CSS.'
  render()
}
function syncSettings() {
  disposeSettings()
  disposeSettings = renderSettings(document.querySelector<HTMLElement>('#settings-mount')!, state, patch => {
    state = applyOperation(state, { type: 'preferences', patch }, 'darwin'); render()
  })
}
document.querySelector('#theme')!.addEventListener('change', event => { document.documentElement.dataset.theme = (event.target as HTMLSelectElement).value })
document.querySelector('#panel-width')!.addEventListener('change', event => { document.documentElement.style.setProperty('--panel-width', (event.target as HTMLSelectElement).value + 'px') })
document.querySelector('#scenario')!.addEventListener('change', event => fixture((event.target as HTMLSelectElement).value))
document.querySelector('#reset')!.addEventListener('click', () => fixture((document.querySelector('#scenario') as HTMLSelectElement).value))
document.querySelector('#settings-dialog')!.addEventListener('close', () => disposeSettings())
document.querySelector('#close-settings')!.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#settings-dialog')!.close())
document.querySelector('#ribbon-quick-access')!.replaceChildren(icon('bookmark'))
document.querySelector('#ribbon-files')!.addEventListener('click', () => {
  mount.hidden = true; document.querySelector<HTMLElement>('#native-files')!.hidden = false
  document.querySelector('#ribbon-files')!.setAttribute('aria-pressed', 'true'); document.querySelector('#ribbon-quick-access')!.setAttribute('aria-pressed', 'false')
})
document.querySelector('#ribbon-quick-access')!.addEventListener('click', () => {
  mount.hidden = false; document.querySelector<HTMLElement>('#native-files')!.hidden = true
  document.querySelector('#ribbon-files')!.setAttribute('aria-pressed', 'false'); document.querySelector('#ribbon-quick-access')!.setAttribute('aria-pressed', 'true')
})
fixture('everyday')
document.documentElement.dataset.prototypeReady = 'true'
