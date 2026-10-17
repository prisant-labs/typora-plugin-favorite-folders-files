import { applyFavoritesOperation, createFavoritesState, locationId, UNGROUPED_GROUP_ID, type FavoritesState, type LocationKind } from '../src/model'
import { BrowseListError, type BrowseEntry, type BrowseSource } from '../src/browse-fs'
import { BrowseController } from '../src/browse-runtime'
import { cloneBrowseRecord, normalizeBrowseRecord, type BrowseRecord } from '../src/browse-store'
import { replayFavoritesDraft } from '../src/editor-state'
import { FavoritesPanelRenderer } from '../src/favorites-panel'
import { favoritesRibbonIcon } from '../src/panel'
import { normalizeHistory, type HistoryInput } from '../src/native-history'
import { renderSettings } from '../src/settings-ui'
import { buildUpdateConfirmation } from '../src/update-confirmation'

const INSTALLED = '0.2.0'
const REPO = 'prisant-labs/typora-plugin-favorite-folders-files'
const mount = document.querySelector<HTMLElement>('#panel-mount')!
const status = document.querySelector<HTMLElement>('#host-status')!
let state: FavoritesState
let current: { file?: string; folder?: string }
let nativeFixture: HistoryInput
let unavailable = new Set<string>()
let error = ''
let disposeSettings = () => {}
let renderer: FavoritesPanelRenderer
// Fixture-only: a newer version that Core's Marketplace would offer.
let update: string | undefined
let checkForUpdates = true
// Fixture-only folders for Browse. A trailing slash marks a folder; null is a folder Browse may not read.
const FOLDERS: Record<string, string[] | null> = {
  '/Projects': ['Atlas/', 'Beacon/', 'Harbor/', 'Roadmap.md', 'Team charter.md'],
  '/Projects/Atlas': ['Research/', 'Budget.xlsx', 'Project brief.md', 'Timeline.md'],
  '/Projects/Atlas/Research': ['Interview notes.md', 'Sources.md'],
  '/Projects/Beacon': ['Launch plan.md'],
  '/Projects/Harbor': [],
  '/Writing': ['Drafts/', 'Private/', 'Weekend essay.md'],
  '/Writing/Drafts': ['Weekend essay draft.md'],
  '/Writing/Private': null,
  '/Home': ['Documents/', 'Notes/', '.config/'],
  '/Home/Documents': ['Ideas.md', 'Meeting notes.md'],
  '/Home/Notes': ['Inbox/', 'Reading list.md'],
  '/Home/Notes/Inbox': ['Quick capture.md'],
  '/Volumes/Archive': ['2024/', 'Index.md'],
  '/Volumes/Archive/2024': ['Year in review.md'],
  '/Volumes/Travel Drive': ['Itinerary.md'],
}
const browseSource: BrowseSource = {
  async list(folder) {
    const names = FOLDERS[folder]
    if (names === null) throw new BrowseListError('denied')
    if (!names) throw new BrowseListError('missing')
    const entries: BrowseEntry[] = names.filter(name => !name.startsWith('.') && (name.endsWith('/') || name.endsWith('.md')))
      .map(name => name.endsWith('/') ? { kind: 'folder', name: name.slice(0, -1), path: `${folder}/${name.slice(0, -1)}` } : { kind: 'file', name, path: `${folder}/${name}` })
    return entries.sort((first, second) => (first.kind === second.kind ? 0 : first.kind === 'folder' ? -1 : 1) || first.name.localeCompare(second.name))
  },
  async drives() { return ['/Volumes/Archive', '/Volumes/Travel Drive'] },
  home: () => '/Home',
}
let browseRecord: BrowseRecord
let browse: BrowseController | undefined
function openUpdate() {
  const dialog = document.querySelector<HTMLDialogElement>('#update-dialog')!, version = update
  if (!version) return
  document.querySelector('#update-mount')!.replaceChildren(buildUpdateConfirmation({
    installed: INSTALLED, version, repo: REPO, isOpen: () => dialog.open, close: () => dialog.close(),
    confirm() {
      dialog.close()
      status.textContent = `Simulated update: in Typora, Community Plugin Core now unloads Favorites, installs ${version}, and reloads it. Saved Favorites are kept.`
      return new Promise(() => {})
    },
  }))
  dialog.showModal()
}
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
    if (nativeFixture.status === 'ready') nativeFixture.entries = [{ kind, path }, ...nativeFixture.entries!.filter(row => row.kind !== kind || row.path !== path)]
    status.textContent = 'Synthetic host confirmed navigation. Actual Typora Save/Discard/Cancel still requires native testing.'
    error = ''; render()
  },
  reveal(kind, path) { status.textContent = 'Simulated Finder ' + (kind === 'file' ? 'reveal' : 'open') + ': ' + path + '. No navigation recorded.' },
  settings() { document.querySelector<HTMLDialogElement>('#settings-dialog')!.showModal(); syncSettings() },
  update: openUpdate,
  browse: {
    toggle: (key, path) => browse!.toggle(key, path), setActive: active => browse!.setActive(active), setCollapsed: collapsed => browse!.setCollapsed(collapsed),
    addRoot: path => browse!.addRoot(path), removeRoot: path => browse!.removeRoot(path), saveRoots: change => browse!.saveRoots(change),
  },
}) }
function render() {
  renderer.update({ state, current, unavailable, error, platform: 'darwin', history: normalizeHistory(nativeFixture, 'darwin'), historySource: { available: true, loading: false }, writable: true, update: update ? { version: update } : undefined, browse: browse?.snapshot })
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
  // Like Typora's list: an order, never ages. Production does not display native dates.
  nativeFixture = { status: 'ready', order: 'global', entries: [
    { kind: 'file', path: '/Notes/Ideas.md' },
    { kind: 'folder', path: '/Library/Research' },
    { kind: 'file', path: '/Projects/Atlas/Project brief.md' },
    { kind: 'file', path: '/Library/Research/Reading list.md' },
    { kind: 'folder', path: '/Projects/Atlas' },
    { kind: 'file', path: '/Notes/Meeting notes.md' },
  ] }
  if (name === 'empty') { nativeFixture.entries = []; current = {} }
  if (name === 'saved') current = { file: '/Projects/Atlas/Project brief.md', folder: '/Projects/Atlas' }
  if (name === 'mixed') current.folder = '/Projects/Atlas'
  if (name === 'missing') unavailable.add(locationId('folder', '/Writing/Drafts', 'darwin'))
  if (name === 'unavailable') nativeFixture = { status: 'unavailable', message: 'Native Recent history is not available in this candidate.' }
  if (name === 'recording-off') nativeFixture = { status: 'recording-off' }
  if (name === 'per-kind') nativeFixture = { ...nativeFixture, order: 'per-kind', entries: nativeFixture.entries!.map(({ kind, path }) => ({ kind, path })) }
  update = name === 'update-available' ? '0.2.1' : undefined
  // Fixture-only Browse record and folders; the Browse controller is production code.
  browse?.dispose()
  browseRecord = normalizeBrowseRecord({ roots: name === 'empty' ? [] : ['/Projects', '/Writing'], expanded: name === 'empty' ? [] : ['folder:/Projects', 'folder:/Projects/Atlas'] }, 'darwin')
  browse = new BrowseController({
    read: async () => cloneBrowseRecord(browseRecord),
    update: async change => (browseRecord = normalizeBrowseRecord(change(cloneBrowseRecord(browseRecord)), 'darwin')),
    close: async () => {},
  }, browseSource, 'darwin', { pollMilliseconds: 0, isVisible: () => !mount.hidden })
  browse.subscribe(() => render()); void browse.start()
  status.textContent = 'Synthetic data and a simulated live Recent list. The panel, editor workflows, model and CSS are production code. Reading Typora\'s real Recent list and real folders happens only in Typora.'
  render()
}
function syncSettings() {
  disposeSettings()
  const history = normalizeHistory(nativeFixture, 'darwin'), ordered = history.status === 'ready' && history.order !== 'per-kind'
  disposeSettings = renderSettings(document.querySelector<HTMLElement>('#settings-mount')!, state, patch => {
    state = applyFavoritesOperation(state, { type: 'favorites:preferences', patch }, 'darwin'); render()
  }, {
    writable: true, version: INSTALLED, author: 'Prisant Labs', repo: REPO, recentAvailable: ordered,
    update: update ? { version: update, open: openUpdate } : undefined,
    updates: { enabled: checkForUpdates, setEnabled(enabled) { checkForUpdates = enabled; syncSettings() } },
    // The production Browse controller keeps the order; render() redraws this page when it changes.
    tabs: browse && { order: browse.snapshot.record.order, writable: browse.snapshot.writable, setOrder: order => browse!.setOrder(order) },
  })
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
