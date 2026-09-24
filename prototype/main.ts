import { applyFavoritesOperation, createFavoritesState, locationId, UNGROUPED_GROUP_ID, type FavoritesState, type LocationKind } from '../src/model'
import { replayFavoritesDraft } from '../src/editor-state'
import { FavoritesPanelRenderer } from '../src/favorites-panel'
import { favoritesRibbonIcon } from '../src/panel'
import { normalizeHistory, type HistoryInput } from '../src/native-history'
import { renderSettings } from '../src/settings-ui'

const mount = document.querySelector<HTMLElement>('#panel-mount')!
const status = document.querySelector<HTMLElement>('#host-status')!
let state: FavoritesState
let current: { file?: string; folder?: string }
let nativeFixture: HistoryInput
let unavailable = new Set<string>()
let error = ''
let disposeSettings = () => {}
let renderer: FavoritesPanelRenderer
function createRenderer() { return new FavoritesPanelRenderer(mount, {
  change(operation) { state = applyFavoritesOperation(state, operation, 'darwin'); render() },
  async commit(draft) {
    if ((document.querySelector('#fail-save') as HTMLInputElement).checked) throw new Error('Simulated storage failure. Your draft is preserved; turn off the failure control to retry.')
    state = replayFavoritesDraft(state, draft, 'darwin'); render(); return state
  },
  open(kind, path) {
    if (unavailable.has(locationId(kind, path, 'darwin'))) { error = 'This location is unavailable. Its Favorite has been kept.'; render(); return }
    if ((document.querySelector('#cancel-navigation') as HTMLInputElement).checked) {
      status.textContent = 'Simulated native cancellation: current location and history are unchanged.'; return
    }
    current[kind] = path
    // Fixture-only host response. Production never maintains a history collector.
    if (nativeFixture.status === 'ready') nativeFixture.entries = [{ kind, path, openedAt: Date.now() }, ...nativeFixture.entries!.filter(row => row.kind !== kind || row.path !== path)]
    status.textContent = 'Synthetic host confirmed navigation. Actual Typora Save/Discard/Cancel still requires native testing.'
    error = ''; render()
  },
  reveal(kind, path) { status.textContent = 'Simulated Finder ' + (kind === 'file' ? 'reveal' : 'open') + ': ' + path + '. No navigation recorded.' },
  settings() { document.querySelector<HTMLDialogElement>('#settings-dialog')!.showModal(); syncSettings() },
}) }
function render() {
  renderer.update({ state, current, unavailable, error, platform: 'darwin', history: normalizeHistory(nativeFixture, 'darwin'), historySource: { available: true, loading: false }, writable: true })
  document.querySelector('#document-path')!.textContent = current.file || 'No document open'
  if (document.querySelector<HTMLDialogElement>('#settings-dialog')!.open) syncSettings()
}
function fixture(name: string) {
  renderer?.dispose(); renderer = createRenderer()
  state = createFavoritesState(); unavailable = new Set(); error = ''
  current = { file: '/Notes/Ideas.md', folder: '/Library/Research' }
  const apply = (operation: Parameters<typeof applyFavoritesOperation>[1]) => { state = applyFavoritesOperation(state, operation, 'darwin') }
  if (name !== 'empty') {
    apply({ type: 'group:create', id: 'projects', name: 'Projects' }); apply({ type: 'group:create', id: 'writing', name: 'Writing' })
    const locations: Array<[LocationKind, string, string]> = [
      ['folder', '/Projects/Atlas', 'projects'], ['file', '/Projects/Atlas/Project brief.md', 'projects'],
      ['folder', '/Writing/Drafts', 'writing'], ['file', '/Writing/Weekend essay.md', 'writing'], ['folder', '/Notes/Inbox', UNGROUPED_GROUP_ID],
    ]
    if (name === 'long') locations.push(['file', '/Library/日本語/Café and a deliberately long document name for narrow panels.md', 'writing'])
    locations.forEach(([kind, path, groupId]) => apply({ type: 'favorite:add', kind, path, groupId }))
  }
  nativeFixture = { status: 'ready', order: 'timestamps', entries: [
    { kind: 'file', path: '/Notes/Ideas.md', openedAt: Date.now() - 120000 },
    { kind: 'folder', path: '/Library/Research', openedAt: Date.now() - 300000 },
    { kind: 'file', path: '/Projects/Atlas/Project brief.md', openedAt: Date.now() - 900000 },
  ] }
  if (name === 'empty') { nativeFixture.entries = []; current = {} }
  if (name === 'saved') current = { file: '/Projects/Atlas/Project brief.md', folder: '/Projects/Atlas' }
  if (name === 'mixed') current.folder = '/Projects/Atlas'
  if (name === 'missing') unavailable.add(locationId('folder', '/Writing/Drafts', 'darwin'))
  if (name === 'unavailable') nativeFixture = { status: 'unavailable', message: 'Native Recent history is not available in this candidate.' }
  if (name === 'recording-off') nativeFixture = { status: 'recording-off' }
  if (name === 'per-kind') nativeFixture = { ...nativeFixture, order: 'per-kind', entries: nativeFixture.entries!.map(({ kind, path }) => ({ kind, path })) }
  status.textContent = 'Synthetic data and a simulated live Recent list. The panel, editor workflows, model and CSS are production code. Reading Typora\'s real Recent list is Windows-only and requires native verification.'
  render()
}
function syncSettings() {
  disposeSettings()
  const history = normalizeHistory(nativeFixture, 'darwin'), ordered = history.status === 'ready' && history.order !== 'per-kind'
  disposeSettings = renderSettings(document.querySelector<HTMLElement>('#settings-mount')!, state, patch => {
    state = applyFavoritesOperation(state, { type: 'favorites:preferences', patch }, 'darwin'); render()
  }, { writable: true, version: '0.1.0', author: 'Prisant Labs', repo: 'prisant-labs/typora-plugin-favorite-folders-files', recentAvailable: ordered })
}
document.querySelector('#theme')!.addEventListener('change', event => { document.documentElement.dataset.theme = (event.target as HTMLSelectElement).value })
document.querySelector('#panel-width')!.addEventListener('change', event => { document.documentElement.style.setProperty('--panel-width', (event.target as HTMLSelectElement).value + 'px') })
document.querySelector('#scenario')!.addEventListener('change', event => fixture((event.target as HTMLSelectElement).value))
document.querySelector('#reset')!.addEventListener('click', () => fixture((document.querySelector('#scenario') as HTMLSelectElement).value))
document.querySelector('#settings-dialog')!.addEventListener('close', () => disposeSettings())
document.querySelector('#close-settings')!.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#settings-dialog')!.close())
document.querySelector('#ribbon-quick-access')!.replaceChildren(favoritesRibbonIcon())
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
