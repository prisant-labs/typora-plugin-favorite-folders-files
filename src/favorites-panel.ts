import {
  ALL_GROUPS_ID, UNGROUPED_GROUP_ID, applyFavoritesOperation, locationId, normalizePath,
  selectFavoriteGroups, selectFavoritesInGroup,
  type Favorite, type FavoritesOperation, type FavoritesPreferences, type FavoritesState,
  type LocationKind, type Platform,
} from './model'
import { browseRows, browseTops, folderName, type BrowseRow } from './browse-model'
import type { BrowseRootsChange, BrowseSnapshot } from './browse-runtime'
import type { PanelTab } from './browse-store'
import { createFavoritesDraft, stageFavoritesDraft, type FavoritesDraft } from './editor-state'
import { historyActivity, selectRecent, type NativeHistorySnapshot, type RecentLocation } from './native-history'
import { icon } from './panel'

export interface FavoritesPanelSnapshot {
  state: FavoritesState
  platform: Platform
  current: { file?: string; folder?: string }
  history: NativeHistorySnapshot
  /** Live source of Typora's Recent list. Absent in synthetic previews. */
  historySource?: { available: boolean; loading: boolean; error?: string }
  writable: boolean
  error?: string
  unavailable?: ReadonlySet<string>
  /** A newer Favorites that Core's Marketplace offers. Absent in synthetic previews. */
  update?: { version: string }
  /** Browse's roots and folder listings. Without it the panel has no Browse tab. */
  browse?: BrowseSnapshot
}
export interface BrowsePanelActions {
  toggle(key: string, path?: string): Promise<void>
  setActive(active: boolean): Promise<void>
  setCollapsed(collapsed: boolean): Promise<void>
  addRoot(path: string): Promise<void>
  removeRoot(path: string): Promise<void>
  saveRoots(change: BrowseRootsChange): Promise<void>
}
export interface FavoritesPanelActions {
  change(operation: FavoritesOperation): void | Promise<unknown>
  commit(draft: FavoritesDraft): Promise<FavoritesState>
  open(kind: LocationKind, path: string, options?: { newWindow?: boolean }): void | Promise<void>
  reveal(kind: LocationKind, path: string): void | Promise<void>
  settings(): void | Promise<unknown>
  /** Opens the update confirmation. */
  update?(): void
  browse?: BrowsePanelActions
}
const RECENT_SOURCE = 'Typora\'s own Recent list (File → Open Recent). Favorites reads it while this panel is open and never saves or changes it.'
type EditorKind = 'add' | 'move' | 'groups' | 'arrange' | 'roots'
type Tab = PanelTab
type Choice = { id: string; kind: LocationKind; path: string }
/** Where the Add Favorite page's location came from, for its label. */
type ChoiceSource = 'current' | 'recent' | 'browse'
const CHOICE_LABELS: Record<ChoiceSource, string> = { current: 'Current', recent: 'Recent', browse: 'Selected' }
interface Editor {
  kind: EditorKind
  draft: FavoritesDraft
  origin: string
  selected?: Choice
  choices: Choice[]
  source: ChoiceSource
  /** The Manage Browse roots page's unsaved roots. */
  roots?: { paths: string[]; home: boolean; drives: boolean; input: string }
  groupId: string
  favorite?: Favorite
  newName: string
  renameId?: string
  renameText: string
  deleting?: string
  error?: string
  pending?: () => void
  saving: boolean
}
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function btn(label: string, key: string, action: (event: MouseEvent) => void, glyph?: string) {
  const node = el('button', glyph ? 'qa-icon-button' : '')
  node.type = 'button'; node.dataset.key = key; node.title = label; node.setAttribute('aria-label', label)
  if (glyph) node.append(icon(glyph)); else node.textContent = label
  node.addEventListener('click', action); return node
}

/** One renderer and editor lifecycle for both native sidebar and offline preview. */
export class FavoritesPanelRenderer {
  private snapshot?: FavoritesPanelSnapshot
  private query = ''
  private popup?: { kind: 'view' | 'groups' | 'items' | 'favorite' | 'group' | 'browse'; id?: string; trigger: string }
  private editor?: Editor
  private undo?: Favorite
  private status = ''
  private actionError = ''
  private composing = false
  private disposed = false
  private mainScroll = 0
  private focusNext?: string
  /** A grip being dragged on Manage groups or Manage Browse roots; `id` is a group ID or a root's location ID. */
  private drag?: { list: 'groups' | 'roots'; id: string; target?: string; after: boolean; pointer: number; x: number; y: number; valid: boolean }
  private dragFrame?: number
  private readonly keyHandler = (event: KeyboardEvent) => {
    if (this.popup && ['favorite', 'group', 'browse'].includes(this.popup.kind) && document.activeElement?.closest('.qa-menu') && this.container.contains(document.activeElement) && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      const items = [...this.container.querySelectorAll<HTMLButtonElement>('.qa-menu button:not(:disabled)')]
      if (!items.length) return
      event.preventDefault(); const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      items[index].focus(); return
    }
    if (event.key !== 'Escape' || (!this.container.contains(document.activeElement) && !this.drag)) return
    event.preventDefault()
    if (this.drag) { this.cancelDrag(); return }
    if (this.popup) { this.focusNext = this.popup.trigger; this.popup = undefined; this.render(); return }
    if (this.editor) this.leaveEditor(() => this.closeEditor())
  }
  private readonly outsideHandler = (event: PointerEvent) => {
    if (!this.popup || !(event.target instanceof Node)) return
    const target = event.target instanceof Element ? event.target : event.target.parentElement
    if (target?.closest('.qa-popover, .qa-menu, [aria-haspopup]') && this.container.contains(target)) return
    this.popup = undefined
    // Do not replace the element receiving pointerdown before its click fires.
    this.container.querySelectorAll('.qa-popover, .qa-menu').forEach(node => node.remove())
    this.container.querySelectorAll('[aria-haspopup][aria-expanded=true]').forEach(node => node.setAttribute('aria-expanded', 'false'))
    this.container.querySelectorAll('.qa-has-menu').forEach(node => node.classList.remove('qa-has-menu'))
  }
  private readonly moveHandler = (event: PointerEvent) => this.moveDrag(event)
  private readonly upHandler = (event: PointerEvent) => this.endDrag(event)
  private readonly cancelHandler = () => this.cancelDrag()

  constructor(private readonly container: HTMLElement, private readonly actions: FavoritesPanelActions) {
    container.classList.add('quick-access', 'qa-favorites'); container.setAttribute('aria-label', 'Favorites')
    document.addEventListener('keydown', this.keyHandler)
    document.addEventListener('pointerdown', this.outsideHandler)
    document.addEventListener('pointermove', this.moveHandler)
    document.addEventListener('pointerup', this.upHandler)
    document.addEventListener('pointercancel', this.cancelHandler)
  }
  update(snapshot: FavoritesPanelSnapshot) { if (!this.disposed) { this.snapshot = snapshot; this.render() } }
  dispose() {
    this.disposed = true; this.cancelDrag()
    document.removeEventListener('keydown', this.keyHandler); document.removeEventListener('pointerdown', this.outsideHandler)
    document.removeEventListener('pointermove', this.moveHandler); document.removeEventListener('pointerup', this.upHandler); document.removeEventListener('pointercancel', this.cancelHandler)
    this.container.replaceChildren()
  }
  private async run(work: () => void | Promise<unknown>) {
    try { await work(); this.actionError = '' } catch (error) { this.actionError = error instanceof Error ? error.message : 'The action could not be completed.' }
    this.render()
  }
  private change(patch: Partial<FavoritesPreferences>) {
    if (!this.snapshot?.writable) return
    this.popup = undefined
    void this.run(() => this.actions.change({ type: 'favorites:preferences', patch }))
  }
  private state() { return this.snapshot!.state }
  /** The tabs in the user's order, which Browse's record keeps. Without Browse, the usual order. */
  private tabs(): Tab[] { return this.snapshot!.browse && this.actions.browse ? [...this.snapshot!.browse.record.order] : ['favorites', 'recent'] }
  /** Browse's own record says when it is selected, so saved Favorites never hold a tab older windows reject. */
  private activeTab(): Tab { return this.tabs().includes('browse') && this.snapshot!.browse!.record.active ? 'browse' : this.state().preferences.activeTab }
  /** The only way the panel changes tabs: every tab change must also clear Browse's selection. */
  private selectTab(tab: Tab) {
    const browse = this.actions.browse, active = this.snapshot!.browse?.record.active
    if (tab === 'browse') { if (browse && !active) { this.popup = undefined; void this.run(() => browse.setActive(true)) }; return }
    if (browse && active) { this.popup = undefined; void this.run(() => browse.setActive(false)) }
    if (this.state().preferences.activeTab !== tab) this.change({ activeTab: tab })
  }
  private projected() {
    return this.editor!.draft.operations.reduce((state, operation) => applyFavoritesOperation(state, operation, this.snapshot!.platform), this.editor!.draft.base)
  }
  private stage(operation: FavoritesOperation) {
    const editor = this.editor!
    try { editor.draft = stageFavoritesDraft(editor.draft, operation, this.snapshot!.platform); editor.error = undefined }
    catch (error) { editor.error = error instanceof Error ? error.message : 'This change could not be applied.' }
    this.render()
  }
  private focus(key: string, preventScroll = false) {
    const node = [...this.container.querySelectorAll<HTMLElement>('[data-key]')].find(node => node.dataset.key === key)
    if (node?.matches(':disabled')) return undefined
    node?.focus({ preventScroll }); return node
  }
  private render() {
    if (this.disposed || this.composing || !this.snapshot) return
    const active = this.container.contains(document.activeElement) ? document.activeElement as HTMLInputElement : undefined
    const focusKey = this.focusNext || active?.dataset.key
    // Re-focusing the same node after a refresh must not scroll it into view: Chromium (Typora on
    // Windows) focuses clicked buttons, so the list would jump back to the clicked Files button or row.
    const restoring = !this.focusNext; this.focusNext = undefined
    const selection = active?.tagName === 'INPUT' && ['text', 'search'].includes(active.type) ? [active.selectionStart, active.selectionEnd] : undefined
    const scroll = this.container.querySelector('.qa-lists, .qa-page-body')?.scrollTop ?? 0
    const header = el('div', 'qa-heading')
    const title = el('h2'); title.append(icon('star'), document.createTextNode('Favorites')); header.append(title)
    const update = this.snapshot.update, openUpdate = this.actions.update
    if (!this.editor && update && openUpdate) {
      const label = `Update Favorites to ${update.version}`
      const pill = el('button', 'qa-update-pill'); pill.type = 'button'; pill.dataset.key = 'update'; pill.title = label; pill.setAttribute('aria-label', label)
      pill.append(icon('update'), el('span', 'qa-update-pill__label', 'Update'), document.createTextNode(update.version))
      pill.addEventListener('click', () => openUpdate()); header.append(pill)
    }
    if (!this.editor) {
      const add = btn('Add Favorite', 'add', () => this.openEditor('add', 'add'), 'plus')
      const groups = btn('Manage groups', 'manage', () => this.openEditor('groups', 'manage'), 'groups')
      add.disabled = groups.disabled = !this.snapshot.writable
      header.append(add, groups, btn('Community Plugin options', 'settings', () => { void this.run(() => this.actions.settings()) }, 'settings'))
    }
    const contents = this.editor ? this.renderEditor() : this.renderMain()
    const status = el('div', 'qa-status', this.snapshot.error || this.actionError || this.status)
    status.setAttribute('role', this.snapshot.error || this.actionError ? 'alert' : 'status'); status.hidden = !status.textContent && !this.undo
    if (this.undo && !this.editor) status.append(btn('Undo', 'undo', () => { void this.restoreFavorite() }))
    this.container.replaceChildren(header, ...contents, status)
    const list = this.container.querySelector('.qa-lists, .qa-page-body')
    if (list) list.scrollTop = scroll
    if (focusKey) {
      const target = this.focus(focusKey, restoring) || this.focus(this.editor ? 'editor-back' : 'search')
      if (target instanceof HTMLInputElement && selection && ['text', 'search'].includes(target.type)) target.setSelectionRange(selection[0], selection[1])
    }
  }
  private renderMain(): HTMLElement[] {
    const { state, history } = this.snapshot!
    const p = state.preferences
    const searchWrap = el('div', 'qa-search'); const search = el('input')
    search.type = 'search'; search.placeholder = 'Search Favorites and Recent'; search.setAttribute('aria-label', search.placeholder); search.dataset.key = 'search'; search.value = this.query
    search.addEventListener('compositionstart', () => { this.composing = true })
    search.addEventListener('input', event => { this.query = search.value; if (!(event as InputEvent).isComposing && !this.composing) this.render() })
    search.addEventListener('compositionend', () => { this.composing = false; this.query = search.value; this.render() })
    searchWrap.append(icon('search'), search)
    const controls = el('div', 'qa-controls'); const toolbar = el('div', 'qa-toolbar')
    const views = this.popupButton('Views', 'view', 'view'); views.prepend(icon('views')); toolbar.append(views)
    const tabs = this.tabs(), active = this.activeTab()
    const showSort = p.layout === 'stacked' || active === 'favorites' || Boolean(this.query)
    if (showSort) {
      const divider = el('span', 'qa-toolbar-divider'); divider.setAttribute('aria-hidden', 'true')
      toolbar.append(this.popupButton(`Groups: ${this.sortName(p.groupSort)}`, 'sort-groups', 'groups'), divider, this.popupButton(`Items: ${this.sortName(p.itemSort)}`, 'sort-items', 'items'))
    } else toolbar.append(active === 'browse' ? this.manageRoots('browse-roots') : this.recentOrder())
    controls.append(toolbar)
    if (this.popup && ['view', 'groups', 'items'].includes(this.popup.kind)) controls.append(this.options())
    const navigation = el('div', 'qa-tabs'); navigation.setAttribute('role', 'tablist'); navigation.setAttribute('aria-label', 'Collections')
    const names: Record<Tab, string> = { favorites: 'Favorites', recent: 'Recent', browse: 'Browse' }
    if (p.layout === 'tabs' && !this.query) for (const [index, tab] of tabs.entries()) {
      const node = btn(names[tab], `tab-${tab}`, () => this.selectTab(tab))
      node.setAttribute('role', 'tab'); node.setAttribute('aria-selected', String(active === tab)); node.tabIndex = active === tab ? 0 : -1
      node.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length]
        this.focusNext = `tab-${next}`; this.selectTab(next)
      }); navigation.append(node)
    }
    const lists = el('div', 'qa-lists')
    if (this.query.trim()) this.renderSearch(lists)
    else {
      const sections: Record<Tab, (lists: HTMLElement) => void> = { favorites: lists => this.renderFavorites(lists), recent: lists => this.renderRecent(lists), browse: lists => this.renderBrowse(lists) }
      for (const tab of tabs) if (p.layout === 'stacked' || active === tab) sections[tab](lists)
    }
    const footer = el('div', 'qa-footer', `${state.favorites.length} Favorites · ${state.groups.length + 1} groups`)
    return [searchWrap, controls, navigation, lists, footer]
  }
  /** Honest order label: "Most recent first" only when every entry has a date. */
  private recentOrder() {
    const { history, historySource } = this.snapshot!, ready = history.status === 'ready'
    const label = el('span', 'qa-quiet', ready ? history.order === 'per-kind' ? 'Typora\'s order' : 'Most recent first' : historySource?.loading ? 'Loading…' : 'Unavailable')
    label.dataset.recentOrder = ''
    label.title = ready && history.order === 'per-kind' ? `${RECENT_SOURCE} Some entries have no date, so each list keeps Typora's order.` : RECENT_SOURCE
    return label
  }
  private sortName(sort: string) { return sort === 'az' ? 'A-Z' : sort === 'recent' ? 'Recently opened' : 'Custom' }
  private popupButton(label: string, key: string, kind: 'view' | 'groups' | 'items') {
    const node = btn(label, key, () => {
      this.popup = this.popup?.kind === kind ? undefined : { kind, trigger: key }; this.render()
      this.container.querySelector<HTMLInputElement>('.qa-popover input:checked')?.focus()
    })
    node.setAttribute('aria-haspopup', 'dialog'); node.setAttribute('aria-expanded', String(this.popup?.kind === kind)); return node
  }
  private options() {
    const kind = this.popup!.kind; const p = this.state().preferences
    const popup = el('div', `qa-popover ${kind === 'view' ? 'qa-view-options' : 'qa-sort-options'}`); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', kind === 'view' ? 'View options' : `${kind} sort`)
    const choices = (legend: string, field: keyof FavoritesPreferences, values: Array<[string, string, boolean?]>) => {
      const set = el('fieldset'); set.append(el('legend', '', legend)); const row = el('div', kind === 'view' ? 'qa-segments' : 'qa-radio-list')
      for (const [value, label, disabled] of values) {
        const wrapper = el('label'); const input = el('input'); input.type = 'radio'; input.name = `qa-${field}`; input.value = value
        input.dataset.key = `option:${field}:${value}`; input.checked = p[field] === value; input.disabled = Boolean(disabled) || !this.snapshot!.writable
        input.addEventListener('change', () => { if (input.checked) { this.focusNext = this.popup!.trigger; this.change({ [field]: value }) } })
        input.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          event.preventDefault(); const available = values.filter(entry => !entry[2]); const index = available.findIndex(entry => entry[0] === value)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + available.length) % available.length
          this.focusNext = this.popup!.trigger; this.change({ [field]: available[next][0] })
        }); wrapper.append(input, document.createTextNode(label)); row.append(wrapper)
      }
      set.append(row); popup.append(set)
    }
    if (kind === 'view') {
      choices('Layout', 'layout', [['tabs', 'Tabs'], ['stacked', 'Stacked']]); choices('Groups', 'groupView', [['outline', 'Outline'], ['filter', 'Filter']])
    } else {
      const capable = this.snapshot!.history.status === 'ready' && this.snapshot!.history.order !== 'per-kind'
      choices(kind === 'groups' ? 'Sort groups' : 'Sort items', kind === 'groups' ? 'groupSort' : 'itemSort', [['custom', 'Custom'], ['az', 'A-Z'], ['recent', 'Recently opened', !capable]])
      if (!capable) popup.append(el('p', 'qa-quiet', this.snapshot!.history.status === 'ready' ? 'Some entries in Typora\'s Recent list have no date, so Recently opened is unavailable.' : 'Recently opened uses Typora\'s Recent list, which isn\'t available here.'))
    }
    return popup
  }
  private sectionHeader(label: string, key: 'favorites' | 'recent', collapsed: boolean) {
    const node = btn(label, `collapse-${key}`, () => this.change({ [key === 'favorites' ? 'favoritesCollapsed' : 'recentCollapsed']: !collapsed }))
    node.className = 'qa-section-toggle'; node.prepend(icon('chevron')); node.setAttribute('aria-expanded', String(!collapsed)); return node
  }
  private renderFavorites(lists: HTMLElement) {
    const state = this.state(), p = state.preferences
    if (p.layout === 'stacked') { lists.append(this.sectionHeader('Favorites', 'favorites', p.favoritesCollapsed)); if (p.favoritesCollapsed) return }
    const groups = selectFavoriteGroups(state, historyActivity(this.snapshot!.history)).groups
    if (p.groupView === 'filter') {
      const heading = el('div', 'qa-group-heading'); const select = el('select'); select.setAttribute('aria-label', 'Favorite group'); select.dataset.key = 'group-filter'
      for (const group of [{ id: ALL_GROUPS_ID, name: 'All groups' }, ...groups]) { const option = el('option', '', group.name); option.value = group.id; select.append(option) }
      select.value = p.selectedGroup; select.addEventListener('change', () => this.change({ selectedGroup: select.value })); heading.append(select)
      if (p.selectedGroup !== ALL_GROUPS_ID) heading.append(this.groupMore(p.selectedGroup, groups.find(group => group.id === p.selectedGroup)!.name))
      lists.append(heading)
      for (const group of groups.filter(group => p.selectedGroup === ALL_GROUPS_ID || group.id === p.selectedGroup)) {
        for (const favorite of selectFavoritesInGroup(state, group.id, historyActivity(this.snapshot!.history)).favorites) lists.append(this.row(favorite))
      }
    } else for (const group of groups) {
      const wrapper = el('section', 'qa-favorite-group'); const heading = el('div', 'qa-group-heading')
      const collapsed = p.collapsedGroups.includes(group.id)
      const toggle = btn(group.name, `group:${group.id}`, () => this.change({ collapsedGroups: collapsed ? p.collapsedGroups.filter(id => id !== group.id) : [...p.collapsedGroups, group.id] }))
      toggle.className = 'qa-group-toggle'; toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.replaceChildren(icon('chevron'), el('span', 'qa-group-name', group.name), el('span', 'qa-count', String(state.itemOrder[group.id].length)))
      heading.append(toggle, this.groupMore(group.id, group.name)); wrapper.append(heading)
      if (!collapsed) { const members = el('div', 'qa-group-members'); for (const favorite of selectFavoritesInGroup(state, group.id, historyActivity(this.snapshot!.history)).favorites) members.append(this.row(favorite)); wrapper.append(members) }
      lists.append(wrapper)
    }
    if (!state.favorites.length) lists.append(el('p', 'qa-empty', 'Add the current document or folder to keep it here.'))
  }
  private groupMore(id: string, name: string) {
    const wrapper = el('div', 'qa-group-actions')
    const key = `group-more:${id}`; const more = btn(`Group actions: ${name}`, key, () => {
      this.popup = this.popup?.kind === 'group' && this.popup.id === id ? undefined : { kind: 'group', id, trigger: key }; this.render()
      this.container.querySelector<HTMLButtonElement>('.qa-menu button')?.focus()
    }, 'more')
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', String(this.popup?.kind === 'group' && this.popup.id === id)); wrapper.append(more)
    if (this.popup?.kind === 'group' && this.popup.id === id) {
      const menu = el('div', 'qa-menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', `Actions for ${name}`)
      const arrange = btn('Arrange Favorites', `arrange:${id}`, () => this.openEditor('arrange', key, id)); arrange.setAttribute('role', 'menuitem'); arrange.tabIndex = -1; arrange.disabled = !this.snapshot!.writable; menu.append(arrange); wrapper.append(menu)
    }
    return wrapper
  }
  private renderRecent(lists: HTMLElement) {
    const { history } = this.snapshot!, p = this.state().preferences
    if (p.layout === 'stacked') { lists.append(this.sectionHeader('Recent', 'recent', p.recentCollapsed)); if (p.recentCollapsed) return }
    // A stored 'all' from earlier builds shows Files, the first filter.
    const kind: LocationKind = p.recentFilter === 'folder' ? 'folder' : 'file'
    const filters = el('div', 'qa-recent-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Recent kind')
    for (const [value, label] of [['file', 'Files'], ['folder', 'Folders']] as const) {
      const node = btn(label, `recent-${value}`, () => this.change({ recentFilter: value })); node.setAttribute('aria-pressed', String(kind === value)); filters.append(node)
    }
    lists.append(filters)
    if (history.status !== 'ready') {
      const source = this.snapshot!.historySource
      const message = source && !source.available ? 'Typora\'s Recent list isn\'t available in this version of Typora.'
        : source?.error || (source?.loading ? 'Reading Typora\'s Recent list…' : history.message || 'Typora\'s Recent list is unavailable.')
      const note = el('p', 'qa-empty', message); if (source?.error) note.setAttribute('role', 'alert'); lists.append(note); return
    }
    const rows = selectRecent(history, kind)
    for (const row of rows) lists.append(this.row(row, 'recent'))
    if (!rows.length) lists.append(el('p', 'qa-empty', kind === 'file' ? 'No recent Markdown files in Typora\'s Recent list.' : 'No recent folders in Typora\'s Recent list.'))
  }
  private manageRoots(key: string) {
    const node = btn('Manage roots', key, () => this.openEditor('roots', key)); node.disabled = !this.snapshot!.browse?.writable; return node
  }
  private fileManager() { const platform = this.snapshot!.platform; return platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'Explorer' : 'file manager' }
  private renderBrowse(lists: HTMLElement) {
    const browse = this.snapshot!.browse!, actions = this.actions.browse!, platform = this.snapshot!.platform
    if (this.state().preferences.layout === 'stacked') {
      // Browse keeps this in its own record: saved Favorites accept only their own section keys.
      const collapsed = browse.record.collapsed
      const header = btn('Browse', 'collapse-browse', () => { void this.run(() => actions.setCollapsed(!collapsed)) })
      header.className = 'qa-section-toggle'; header.prepend(icon('chevron')); header.setAttribute('aria-expanded', String(!collapsed)); lists.append(header)
      if (collapsed) return
      const bar = el('div', 'qa-browse-bar'); bar.append(this.manageRoots('browse-roots-stacked')); lists.append(bar)
    }
    if (!browse.available) { lists.append(el('p', 'qa-empty', 'Browsing folders isn\'t available in this Typora window.')); return }
    const tops = browseTops(browse.record, browse.home, platform)
    if (!tops.length) { lists.append(el('p', 'qa-empty', 'Add a root folder to browse from it.')); return }
    const { rows } = browseRows(tops, browse.folders, new Set(browse.record.expanded), platform)
    const tree = el('div', 'qa-tree'), items = rows.filter(row => row.type !== 'note')
    for (const row of rows) tree.append(this.browseRow(row, items))
    lists.append(tree)
  }
  private browseRow(row: BrowseRow, items: BrowseRow[]) {
    const depth = String(row.depth)
    if (row.type === 'note') { const note = el('p', `qa-tree-note${row.note === 'error' ? ' qa-tree-error' : ''}`, row.name); note.dataset.depth = depth; note.style.setProperty('--qa-depth', depth); return note }
    const { platform, current } = this.snapshot!, browse = this.actions.browse!, path = row.path
    const kind: LocationKind = row.type === 'file' ? 'file' : 'folder', key = `browse:${row.id}`
    let id: string | undefined, isCurrent = false
    try { if (path) { id = locationId(kind, path, platform); isCurrent = Boolean(current[kind] && locationId(kind, current[kind]!, platform) === id) } } catch { /* Not a navigation target. */ }
    const wrapper = el('div', 'qa-row-wrapper'), line = el('div', `qa-row qa-tree-row${row.depth === 0 ? ' qa-tree-top' : ''}`)
    line.classList.toggle('qa-current', isCurrent)
    const newWindow = platform === 'win32'
    const main = btn(row.type === 'file' ? `Open ${row.name}` : `${row.expanded ? 'Collapse' : 'Expand'} ${row.name}`, key, event => {
      if (row.type === 'file') void this.run(() => this.actions.open('file', path!, { newWindow: newWindow && (event.ctrlKey || event.metaKey) }))
      else void this.run(() => browse.toggle(row.key, path))
    })
    main.className = 'qa-open qa-tree-open'; main.dataset.depth = depth; main.style.setProperty('--qa-depth', depth)
    if (row.type === 'file') { if (isCurrent) main.setAttribute('aria-current', 'location') } else main.setAttribute('aria-expanded', String(Boolean(row.expanded)))
    main.title = !path ? row.name : row.type === 'file' && newWindow ? `${path}\nClick to open in this window · Ctrl+click for a new window` : path
    const name = el('span', 'qa-name', row.name), labels = el('span', 'qa-row-label')
    if (isCurrent) name.append(el('span', 'qa-current-label', ' Current'))
    labels.append(name)
    // Top folders say where they are, unless that is just the file system root; deeper rows show it by their place in the tree.
    const where = path && row.depth === 0 ? parentOf(path) : '/'
    if (where !== '/' && where !== row.name) { const meta = el('span', 'qa-meta'); meta.append(el('span', 'qa-path', where)); labels.append(meta) }
    const glyph = row.type === 'home' ? 'home' : row.type === 'drives' || row.type === 'drive' ? 'drive' : kind
    main.replaceChildren(row.type === 'file' ? el('span', 'qa-tree-spacer') : icon('chevron'), icon(glyph), labels)
    main.addEventListener('keydown', event => this.treeKey(event, row, items))
    line.append(main); wrapper.append(line)
    if (!path) return wrapper
    const actions = el('div', 'qa-row-actions')
    const saved = this.state().favorites.find(favorite => favorite.id === id)
    const star = btn(`${saved ? 'Remove Favorite' : 'Add Favorite'}: ${row.name}`, `star:${key}`, () => {
      if (saved) void this.removeFavorite(saved)
      else if (id) this.openEditor('add', `star:${key}`, undefined, undefined, { id, kind, path }, 'browse')
    }, 'star'); star.disabled = !this.snapshot!.writable || !id; star.setAttribute('aria-pressed', String(Boolean(saved)))
    actions.append(star, btn(`${kind === 'folder' ? 'Open in' : 'Reveal in'} ${this.fileManager()}: ${row.name}`, `reveal:${key}`, () => { void this.run(() => this.actions.reveal(kind, path)) }, 'reveal'))
    if (kind === 'folder') {
      const menuKey = `more:${key}`, open = this.popup?.kind === 'browse' && this.popup.id === row.id
      const more = btn(`More: ${row.name}`, menuKey, () => {
        this.popup = open ? undefined : { kind: 'browse', id: row.id, trigger: menuKey }; this.render(); this.container.querySelector<HTMLButtonElement>('.qa-menu button')?.focus()
      }, 'more'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', String(open)); actions.append(more)
      if (open) {
        line.classList.add('qa-has-menu'); const menu = el('div', 'qa-menu qa-item-menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', `Actions for ${row.name}`)
        const record = this.snapshot!.browse!.record, isRoot = record.roots.some(root => { try { return locationId('folder', root, platform) === id } catch { return false } })
        const typora = btn('Open in Typora', 'browse-open-folder', () => { this.popup = undefined; void this.run(() => this.actions.open('folder', path)) })
        typora.title = 'Make this the folder Typora has open, as its own Files list shows it'
        const root = isRoot
          ? btn('Remove from Browse roots', 'browse-remove-root', () => { this.popup = undefined; void this.run(async () => { await browse.removeRoot(path); this.undo = undefined; this.status = `Removed ${folderName(path)} from Browse roots.` }) })
          : btn('Add to Browse roots', 'browse-add-root', () => { this.popup = undefined; void this.run(async () => { await browse.addRoot(path); this.undo = undefined; this.status = `Added ${folderName(path)} to Browse roots.` }) })
        root.disabled = !this.snapshot!.browse!.writable
        for (const item of [typora, root]) { item.setAttribute('role', 'menuitem'); item.tabIndex = -1 }
        menu.append(typora, root); wrapper.append(menu)
      }
    }
    line.append(actions)
    return wrapper
  }
  /** Up and Down move between rows; Right expands or steps in; Left collapses or steps out. */
  private treeKey(event: KeyboardEvent, row: BrowseRow, items: BrowseRow[]) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const index = items.findIndex(item => item.id === row.id), folder = row.type !== 'file', next = items[index + 1]
    const move = (target?: BrowseRow) => { if (target) this.focus(`browse:${target.id}`) }
    const toggle = () => { void this.run(() => this.actions.browse!.toggle(row.key, row.path)) }
    if (event.key === 'ArrowDown') move(next)
    else if (event.key === 'ArrowUp') move(items[index - 1])
    else if (event.key === 'ArrowRight') { if (folder && !row.expanded) toggle(); else if (folder && next && next.depth > row.depth) move(next) }
    else if (folder && row.expanded) toggle()
    else move(items.slice(0, index).reverse().find(item => item.depth < row.depth))
  }
  private renderSearch(lists: HTMLElement) {
    const state = this.state(), query = this.query.trim().toLocaleLowerCase(); const seen = new Set<string>()
    const matches = (row: Choice, groupName = '') => `${nameOf(row.path)} ${row.path} ${groupName}`.toLocaleLowerCase().includes(query)
    for (const favorite of state.favorites) {
      const group = favorite.groupId === UNGROUPED_GROUP_ID ? 'Ungrouped' : state.groups.find(group => group.id === favorite.groupId)!.name
      if (matches(favorite, group)) { lists.append(this.row(favorite, 'search')); seen.add(favorite.id) }
    }
    if (this.snapshot!.history.status === 'ready') for (const row of this.snapshot!.history.entries) {
      if (!seen.has(row.id) && matches(row)) { lists.append(this.row(row, 'search')); seen.add(row.id) }
    }
    if (!seen.size) lists.append(el('p', 'qa-empty', 'No matching locations.'))
    lists.prepend(el('p', 'qa-search-summary', `${seen.size} matching locations`))
  }
  private row(location: Favorite | RecentLocation, collection = 'favorites') {
    const saved = this.state().favorites.find(row => row.id === location.id), name = nameOf(location.path)
    const rowKey = `${collection}:${location.id}`
    const wrapper = el('div', 'qa-row-wrapper'); const row = el('div', 'qa-row'); row.dataset.location = location.id
    const current = this.snapshot!.current[location.kind]
    let isCurrent = false
    try { isCurrent = Boolean(current && locationId(location.kind, current, this.snapshot!.platform) === location.id) } catch { /* Unsaved location. */ }
    row.classList.toggle('qa-current', isCurrent)
    const newWindow = this.snapshot!.platform === 'win32'
    const open = btn(`Open ${name}`, `open:${rowKey}`, event => { void this.run(() => this.actions.open(location.kind, location.path, { newWindow: newWindow && (event.ctrlKey || event.metaKey) })) })
    open.className = 'qa-open'; if (isCurrent) open.setAttribute('aria-current', 'location')
    const here = isCurrent && location.kind === 'folder' ? 'Already open in this window' : 'Click to open in this window'
    open.title = newWindow ? `${location.path}\n${here} · Ctrl+click for a new window` : location.path
    const labels = el('span', 'qa-row-label'), title = el('span', 'qa-name', name)
    if (isCurrent) title.append(el('span', 'qa-current-label', ' Current'))
    if (this.snapshot!.unavailable?.has(location.id)) title.append(el('span', 'qa-missing', ' · Unavailable'))
    const meta = el('span', 'qa-meta'); meta.append(el('span', 'qa-path', parentOf(location.path)))
    if ('openedAt' in location && location.openedAt !== undefined && location.openedAt <= Date.now()) {
      const minutes = Math.floor((Date.now() - location.openedAt) / 60000); const age = minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`
      meta.append(el('span', 'qa-age', age))
    }
    labels.append(title, meta); open.replaceChildren(icon(location.kind), labels)
    const actions = el('div', 'qa-row-actions')
    const star = btn(`${saved ? 'Remove Favorite' : 'Add Favorite'}: ${name}`, `star:${rowKey}`, () => {
      if (saved) void this.removeFavorite(saved)
      else this.openEditor('add', `star:${rowKey}`, undefined, undefined, location)
    }, 'star'); star.disabled = !this.snapshot!.writable; star.setAttribute('aria-pressed', String(Boolean(saved)))
    actions.append(star, btn(`${location.kind === 'folder' ? 'Open in' : 'Reveal in'} ${this.fileManager()}: ${name}`, `reveal:${rowKey}`, () => { void this.run(() => this.actions.reveal(location.kind, location.path)) }, 'reveal'))
    if (saved) {
      const key = `more:${rowKey}`; const more = btn(`More: ${name}`, key, () => {
        this.popup = this.popup?.kind === 'favorite' && this.popup.id === rowKey ? undefined : { kind: 'favorite', id: rowKey, trigger: key }; this.render(); this.container.querySelector<HTMLButtonElement>('.qa-menu button')?.focus()
      }, 'more'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', String(this.popup?.kind === 'favorite' && this.popup.id === rowKey)); actions.append(more)
    }
    row.append(open, actions); wrapper.append(row)
    if (saved && this.popup?.kind === 'favorite' && this.popup.id === rowKey) {
      row.classList.add('qa-has-menu'); const menu = el('div', 'qa-menu qa-item-menu'); menu.setAttribute('role', 'menu')
      const move = btn('Move Favorite to group', 'move-favorite', () => this.openEditor('move', `more:${rowKey}`, saved.groupId, saved))
      const remove = btn('Remove from Favorites', 'remove-favorite', () => { void this.removeFavorite(saved) }); move.disabled = remove.disabled = !this.snapshot!.writable
      menu.setAttribute('aria-label', `Actions for ${name}`); move.setAttribute('role', 'menuitem'); remove.setAttribute('role', 'menuitem'); move.tabIndex = remove.tabIndex = -1
      menu.append(move, remove); wrapper.append(menu)
    }
    return wrapper
  }
  private async removeFavorite(favorite: Favorite) {
    this.popup = undefined
    await this.run(async () => { await this.actions.change({ type: 'favorite:remove', favoriteId: favorite.id }); this.undo = { ...favorite }; this.status = 'Favorite removed.' })
  }
  private async restoreFavorite() {
    const favorite = this.undo; if (!favorite) return
    const exists = favorite.groupId === UNGROUPED_GROUP_ID || this.state().groups.some(group => group.id === favorite.groupId)
    await this.run(async () => {
      await this.actions.change({ type: 'favorite:add', kind: favorite.kind, path: favorite.path, groupId: exists ? favorite.groupId : UNGROUPED_GROUP_ID })
      this.undo = undefined; this.status = exists ? 'Favorite restored.' : 'Favorite restored to Ungrouped because its former group was deleted.'
    })
  }
  private openEditor(kind: EditorKind, origin: string, groupId = UNGROUPED_GROUP_ID, favorite?: Favorite, choice?: Choice, source: ChoiceSource = 'recent') {
    const browse = this.snapshot!.browse
    if (kind === 'roots' ? !browse?.writable : !this.snapshot!.writable) return
    this.mainScroll = this.container.querySelector('.qa-lists')?.scrollTop ?? 0
    const choices: Choice[] = []
    for (const type of ['file', 'folder'] as const) {
      const path = this.snapshot!.current[type]
      if (path) try { choices.push({ id: locationId(type, path, this.snapshot!.platform), kind: type, path }) } catch { /* Not an eligible saved path. */ }
    }
    this.editor = { kind, origin, draft: createFavoritesDraft(this.state()), choices: choice ? [choice] : choices, source: choice ? source : 'current', selected: choice, groupId, favorite, newName: '', renameText: '', saving: false }
    if (kind === 'roots' && browse) this.editor.roots = { paths: [...browse.record.roots], home: browse.record.home, drives: browse.record.drives, input: '' }
    this.popup = undefined; this.focusNext = 'editor-back'; this.render()
    const body = this.container.querySelector('.qa-page-body'); if (body) body.scrollTop = 0
  }
  private dirty() {
    const e = this.editor!
    if (e.roots) {
      const record = this.snapshot!.browse!.record
      return Boolean(e.roots.input) || e.roots.home !== record.home || e.roots.drives !== record.drives || e.roots.paths.join('\n') !== record.roots.join('\n')
    }
    return e.draft.operations.length > 0 || Boolean(e.selected) || (e.kind === 'move' && e.groupId !== e.favorite?.groupId) || Boolean(e.newName || e.renameId)
  }
  private editorWritable() { return this.editor?.kind === 'roots' ? Boolean(this.snapshot!.browse?.writable) : this.snapshot!.writable }
  /** Typing updates Save and the draft label without a re-render, which would drop an IME composition. */
  private syncDraftState() {
    const save = this.container.querySelector<HTMLButtonElement>('[data-key="editor-save"]'); if (save) save.disabled = !this.dirty() || !this.editorWritable()
    const status = this.container.querySelector('.qa-draft-state'); if (status) status.textContent = this.dirty() ? 'Unsaved changes' : 'No changes yet'
  }
  private leaveEditor(action: () => void) {
    if (!this.editor || this.editor.saving) return
    if (this.dirty()) { this.editor.pending = action; this.render(); this.focus('keep-editing') } else action()
  }
  private closeEditor() {
    const origin = this.editor?.origin; this.editor = undefined; this.cancelDrag(); this.focusNext = origin; this.render()
    const list = this.container.querySelector('.qa-lists'); if (list) list.scrollTop = this.mainScroll
  }
  private goTo(favorite: Favorite) {
    this.leaveEditor(() => {
      this.query = ''; this.editor = undefined; this.focusNext = `more:favorites:${favorite.id}`
      void this.run(async () => {
        if (this.snapshot!.browse?.record.active) await this.actions.browse?.setActive(false)
        await this.actions.change({ type: 'favorites:preferences', patch: { activeTab: 'favorites', favoritesCollapsed: false, selectedGroup: favorite.groupId, collapsedGroups: this.state().preferences.collapsedGroups.filter(id => id !== favorite.groupId) } })
        this.focusNext = `more:favorites:${favorite.id}`; this.render(); this.focus(`more:favorites:${favorite.id}`)?.scrollIntoView?.({ block: 'nearest' })
      })
    })
  }
  private renderEditor(): HTMLElement[] {
    const e = this.editor!, state = this.projected()
    const groupName = e.groupId === UNGROUPED_GROUP_ID ? 'Ungrouped' : state.groups.find(group => group.id === e.groupId)?.name || 'Deleted group'
    const title = e.kind === 'add' ? 'Add Favorite' : e.kind === 'move' ? 'Move Favorite' : e.kind === 'groups' ? 'Manage groups' : e.kind === 'roots' ? 'Manage Browse roots' : `Arrange Favorites · ${groupName}`
    const page = el('section', 'qa-editor'); const heading = el('div', 'qa-page-heading')
    const back = btn('Back', 'editor-back', () => this.leaveEditor(() => this.closeEditor()), 'back'); back.disabled = e.saving
    heading.append(back, el('h3', '', title)); page.append(heading)
    const body = el('div', 'qa-page-body')
    if (e.pending) {
      const prompt = el('div', 'qa-discard'); prompt.setAttribute('role', 'alertdialog'); prompt.setAttribute('aria-label', 'Discard changes?')
      prompt.append(el('strong', '', 'Discard changes?'), el('p', '', 'Your changes have not been saved.'), btn('Keep editing', 'keep-editing', () => { e.pending = undefined; this.render() }), btn('Discard changes', 'discard', () => { const action = e.pending!; e.pending = undefined; action() })); body.append(prompt)
    }
    if (e.kind === 'add') this.addPage(body, e)
    else if (e.kind === 'move') this.movePage(body, e, state)
    else if (e.kind === 'groups') this.groupsPage(body, e, state)
    else if (e.kind === 'roots') this.rootsPage(body, e)
    else this.arrangePage(body, e, state)
    if (e.error) { const error = el('p', 'qa-page-error', e.error); error.setAttribute('role', 'alert'); body.append(error) }
    const footer = el('div', 'qa-page-footer'); const buttons = el('div', 'qa-page-buttons')
    const allSaved = e.kind === 'add' && e.choices.every(choice => this.state().favorites.some(row => row.id === choice.id))
    if (allSaved) buttons.append(btn('Done', 'editor-done', () => this.leaveEditor(() => this.closeEditor())))
    else {
      footer.append(el('span', 'qa-draft-state', e.saving ? 'Saving…' : this.dirty() ? 'Unsaved changes' : 'No changes yet'))
      const cancel = btn('Cancel', 'editor-cancel', () => this.leaveEditor(() => this.closeEditor()))
      const save = btn('Save', 'editor-save', () => { void this.saveEditor() }); save.className = 'qa-primary'
      cancel.disabled = e.saving; save.disabled = e.saving || Boolean(e.pending) || !this.dirty() || !this.editorWritable()
      buttons.append(cancel, save)
    }
    footer.append(buttons); page.append(body, footer)
    if (e.saving || e.pending) body.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(node => { if (!node.closest('.qa-discard')) node.disabled = true })
    return [page]
  }
  private addPage(body: HTMLElement, e: Editor) {
    const allSaved = e.choices.length > 0 && e.choices.every(choice => this.state().favorites.some(row => row.id === choice.id))
    body.append(el('p', 'qa-page-note', allSaved ? e.choices.length === 2 ? 'Both current locations are already in Favorites.' : 'This location is already in Favorites.' : 'Select a location, choose its group, then Save.'))
    if (!e.choices.length) body.append(el('p', 'qa-empty', 'No saved Markdown document or working folder is currently available.'))
    for (const choice of e.choices) {
      const saved = this.state().favorites.find(row => row.id === choice.id)
      const label = `${CHOICE_LABELS[e.source]} ${choice.kind === 'file' ? 'document' : 'folder'}: ${nameOf(choice.path)}`
      const card = el(saved ? 'div' : 'label', 'qa-location-choice'); card.append(icon(choice.kind)); const copy = el('span', 'qa-location-copy'); copy.append(el('strong', '', label), el('small', '', choice.path))
      card.append(copy)
      if (saved) {
        const name = saved.groupId === UNGROUPED_GROUP_ID ? 'Ungrouped' : this.state().groups.find(group => group.id === saved.groupId)!.name
        copy.append(el('span', 'qa-saved-status', `Saved in ${name}`), btn(`Go to Favorite: ${nameOf(choice.path)}`, `go:${choice.id}`, () => this.goTo(saved)))
      } else {
        const input = el('input'); input.type = 'radio'; input.name = 'qa-add-location'; input.setAttribute('aria-label', label); input.dataset.key = `choice:${choice.id}`; input.checked = e.selected?.id === choice.id
        input.addEventListener('change', () => { e.selected = choice; this.render() }); card.append(input)
      }
      body.append(card)
    }
    if (!allSaved && e.choices.length) {
      const label = el('label', 'qa-destination-label', 'Save in group'); const select = el('select'); select.setAttribute('aria-label', 'Save in group'); select.dataset.key = 'add-destination'
      for (const group of selectFavoriteGroups(this.state()).groups) { const option = el('option', '', group.name); option.value = group.id; select.append(option) }
      select.value = e.groupId; select.addEventListener('change', () => { e.groupId = select.value }); label.append(select); body.append(label, el('p', 'qa-page-note', 'Each location can be saved once. Already-saved locations are shown with their group.'))
    } else if (allSaved) body.append(el('p', 'qa-page-note', 'Nothing needs saving. Go to a Favorite to move it or remove its shortcut.'))
  }
  private movePage(body: HTMLElement, e: Editor, state: FavoritesState) {
    const summary = el('div', 'qa-location-choice'); summary.append(icon(e.favorite!.kind), el('span', 'qa-location-copy', e.favorite!.path)); body.append(summary)
    for (const group of selectFavoriteGroups(state).groups) {
      const label = el('label', 'qa-destination-choice'); const input = el('input'); input.type = 'radio'; input.name = 'qa-move-group'; input.checked = e.groupId === group.id; input.dataset.key = `destination:${group.id}`
      input.addEventListener('change', () => { e.groupId = group.id; this.render() }); label.append(input, el('span', '', group.name))
      if (group.id === e.favorite!.groupId) label.append(el('small', 'qa-current-label', 'Current group'))
      body.append(label)
    }
  }
  private manualNotice(body: HTMLElement, mode: string, field: 'groupSort' | 'itemSort') {
    body.append(el('p', 'qa-page-note', mode === 'custom' ? field === 'groupSort' ? 'Drag a grip or use arrows to arrange groups.' : 'Use arrows to arrange Favorites in this group.' : `Currently sorted ${this.sortName(mode)}. Arrange manually stages Custom; Save applies it to ${field === 'groupSort' ? 'Groups' : 'Items in every group'}.`))
    if (mode !== 'custom') body.append(btn('Arrange manually', 'arrange-manually', () => this.stage({ type: 'favorites:preferences', patch: { [field]: 'custom' } })))
  }
  private groupsPage(body: HTMLElement, e: Editor, state: FavoritesState) {
    body.append(el('h4', 'qa-page-section', 'Organize groups'))
    this.manualNotice(body, state.preferences.groupSort, 'groupSort')
    const custom = state.preferences.groupSort === 'custom'
    for (const group of selectFavoriteGroups(state, historyActivity(this.snapshot!.history)).groups) {
      const row = el('div', 'qa-edit-group'); row.dataset.groupId = group.id
      if (!group.ungrouped) {
        const grip = btn(`Drag group: ${group.name}`, `drag:${group.id}`, () => {}, 'grip'); grip.classList.add('qa-drag-handle'); grip.disabled = !custom
        grip.addEventListener('pointerdown', event => { if (!custom || e.saving) return; event.preventDefault(); this.drag = { list: 'groups', id: group.id, after: false, pointer: event.pointerId, x: event.clientX, y: event.clientY, valid: false }; row.classList.add('qa-dragging') })
        row.append(grip)
      } else row.append(el('span', 'qa-fixed', '·'))
      row.append(el('span', 'qa-edit-name', group.name), el('span', 'qa-quiet', String(state.itemOrder[group.id].length)))
      if (!group.ungrouped) {
        const index = state.groupOrder.indexOf(group.id)
        for (const [direction, delta] of [['up', -1], ['down', 1]] as const) {
          const move = btn(`Move ${direction}: ${group.name}`, `${direction}:${group.id}`, () => { const order = [...state.groupOrder]; [order[index], order[index + delta]] = [order[index + delta], order[index]]; this.stage({ type: 'group:reorder', groupIds: order }) }, direction)
          move.disabled = !custom || index + delta < 0 || index + delta >= state.groupOrder.length; row.append(move)
        }
        row.append(btn(`Rename group: ${group.name}`, `rename:${group.id}`, () => { e.renameId = group.id; e.renameText = group.name; this.focusNext = 'rename-input'; this.render() }, 'edit'), btn(`Delete group: ${group.name}`, `delete:${group.id}`, () => { e.deleting = group.id; this.render() }, 'trash'))
      } else row.append(el('small', 'qa-quiet', 'Always last'))
      body.append(row)
      if (e.renameId === group.id) {
        const form = el('div', 'qa-inline-form'), input = el('input'); input.value = e.renameText; input.maxLength = 60; input.setAttribute('aria-label', 'Rename group'); input.dataset.key = 'rename-input'; input.addEventListener('input', () => { e.renameText = input.value })
        this.preserveComposition(input)
        form.append(input, btn('Apply name', 'apply-name', () => { try { const draft = stageFavoritesDraft(e.draft, { type: 'group:rename', groupId: group.id, name: e.renameText }, this.snapshot!.platform); e.draft = draft; e.renameId = undefined; e.error = undefined } catch (error) { e.error = (error as Error).message }; this.render() }), btn('Cancel rename', 'cancel-rename', () => { e.renameId = undefined; this.render() })); body.append(form)
      }
      if (e.deleting === group.id) {
        const confirm = el('div', 'qa-delete-confirm'); confirm.append(el('p', '', `Delete ${group.name}? Its Favorites will move to Ungrouped when you Save.`), btn('Delete group', 'confirm-delete', () => { e.deleting = undefined; this.stage({ type: 'group:delete', groupId: group.id }) }), btn('Keep group', 'keep-group', () => { e.deleting = undefined; this.render() })); body.append(confirm)
      }
    }
    body.append(el('h4', 'qa-page-section', 'New group'))
    const form = el('div', 'qa-new-group'), label = el('label'), input = el('input'); input.placeholder = 'Group name'; input.value = e.newName; input.maxLength = 60; input.dataset.key = 'new-group-name'; input.setAttribute('aria-label', 'New group name')
    input.addEventListener('input', () => { e.newName = input.value; this.syncDraftState() })
    this.preserveComposition(input)
    label.append(input); form.append(label, btn('Add group', 'add-group', () => {
      try { const id = `group-${globalThis.crypto.randomUUID()}`; e.draft = stageFavoritesDraft(e.draft, { type: 'group:create', id, name: e.newName }, this.snapshot!.platform); e.newName = ''; e.error = undefined } catch (error) { e.error = (error as Error).message }; this.render()
    })); body.append(form, el('p', 'qa-page-note', 'New groups, names and order are only applied when you Save.'))
  }
  private arrangePage(body: HTMLElement, e: Editor, state: FavoritesState) {
    this.manualNotice(body, state.preferences.itemSort, 'itemSort')
    const custom = state.preferences.itemSort === 'custom'; const order = state.itemOrder[e.groupId]
    for (const favorite of selectFavoritesInGroup(state, e.groupId, historyActivity(this.snapshot!.history)).favorites) {
      const row = el('div', 'qa-reorder-item'); row.append(icon(favorite.kind), el('span', 'qa-edit-name', nameOf(favorite.path))); row.title = favorite.path
      const index = order.indexOf(favorite.id)
      for (const [direction, delta] of [['up', -1], ['down', 1]] as const) {
        const move = btn(`Move ${direction}: ${nameOf(favorite.path)}`, `${direction}:${favorite.id}`, () => { const next = [...order]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; this.stage({ type: 'favorite:reorder', groupId: e.groupId, favoriteIds: next }) }, direction)
        move.disabled = !custom || index + delta < 0 || index + delta >= order.length; row.append(move)
      }; body.append(row)
    }
    if (!order.length) body.append(el('p', 'qa-empty', 'This group has no Favorites yet.'))
  }
  private rootId(path: string) { try { return locationId('folder', path, this.snapshot!.platform) } catch { return path } }
  private rootsPage(body: HTMLElement, e: Editor) {
    const r = e.roots!, { platform, current } = this.snapshot!, browse = this.snapshot!.browse!
    const id = (path: string) => this.rootId(path)
    body.append(el('p', 'qa-page-note', 'Browse shows these folders first, in this order. It lists folders and Markdown files only, and never moves, renames or deletes anything.'))
    body.append(el('h4', 'qa-page-section', 'Root folders'))
    if (!r.paths.length) body.append(el('p', 'qa-empty', 'No root folders yet.'))
    else body.append(el('p', 'qa-page-note', 'Drag a grip or use arrows to arrange roots.'))
    r.paths.forEach((path, index) => {
      const name = folderName(path), row = el('div', 'qa-reorder-item qa-root-item'), copy = el('span', 'qa-root-copy'); row.title = path; row.dataset.rootId = id(path)
      const grip = btn(`Drag root: ${name}`, `root-drag:${id(path)}`, () => {}, 'grip'); grip.classList.add('qa-drag-handle')
      grip.addEventListener('pointerdown', event => { if (e.saving) return; event.preventDefault(); this.drag = { list: 'roots', id: id(path), after: false, pointer: event.pointerId, x: event.clientX, y: event.clientY, valid: false }; row.classList.add('qa-dragging') })
      copy.append(el('span', 'qa-edit-name', name), el('small', 'qa-root-path', path)); row.append(grip, copy)
      for (const [direction, delta] of [['up', -1], ['down', 1]] as const) {
        const move = btn(`Move ${direction}: ${name}`, `root-${direction}:${id(path)}`, () => { const paths = [...r.paths]; [paths[index], paths[index + delta]] = [paths[index + delta], paths[index]]; r.paths = paths; this.render() }, direction)
        move.disabled = index + delta < 0 || index + delta >= r.paths.length; row.append(move)
      }
      row.append(btn(`Remove root: ${name}`, `root-remove:${id(path)}`, () => { r.paths = r.paths.filter((_, position) => position !== index); this.render() }, 'trash'))
      body.append(row)
    })
    const folder = current.folder
    if (folder && !r.paths.some(path => id(path) === id(folder))) {
      const add = btn(`Add current folder: ${folderName(folder)}`, 'roots-add-current', () => { r.paths = [...r.paths, folder]; this.render() }); add.className = 'qa-add-root'; body.append(add)
    }
    const example = platform === 'win32' ? 'D:\\Notes' : '/Volumes/Notes'
    const form = el('div', 'qa-new-group'), label = el('label', '', 'Add a folder by its full path'), input = el('input')
    input.placeholder = example; input.value = r.input; input.dataset.key = 'root-path'; input.setAttribute('aria-label', 'Folder path'); input.spellcheck = false
    const add = () => {
      let path: string
      try { path = normalizePath(r.input.trim(), platform) } catch { e.error = `Enter a full folder path, such as ${example}.`; this.render(); return }
      if (r.paths.some(root => id(root) === id(path))) { e.error = 'That folder is already a root.'; this.render(); return }
      r.paths = [...r.paths, path]; r.input = ''; e.error = undefined; this.focusNext = 'root-path'; this.render()
    }
    input.addEventListener('input', () => { r.input = input.value; this.syncDraftState() })
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); add() } })
    this.preserveComposition(input)
    label.append(input); form.append(label, btn('Add folder', 'roots-add-path', add)); body.append(form)
    body.append(el('h4', 'qa-page-section', 'Also show'))
    for (const [field, text] of [['home', 'Home folder'], ['drives', platform === 'darwin' ? 'Volumes' : 'Drives']] as const) {
      const wrapper = el('label', 'qa-check'), box = el('input'); box.type = 'checkbox'; box.checked = r[field]; box.dataset.key = `roots-${field}`; box.setAttribute('aria-label', text)
      box.addEventListener('change', () => { r[field] = box.checked; this.render() }); wrapper.append(box, document.createTextNode(text)); body.append(wrapper)
    }
    if (!browse.home) body.append(el('p', 'qa-page-note', 'This Typora window does not say where your home folder is, so Home stays hidden.'))
  }
  private async saveEditor() {
    const e = this.editor; if (!e || e.saving || e.pending || !this.editorWritable()) return
    if (e.roots) {
      if (e.roots.input.trim()) { e.error = 'Add or clear the folder path before saving.'; this.render(); return }
      e.saving = true; e.error = undefined; this.render()
      try {
        await this.actions.browse!.saveRoots({ roots: e.roots.paths, home: e.roots.home, drives: e.roots.drives })
        if (!this.disposed && this.editor === e) this.closeEditor()
      } catch (error) { if (!this.disposed && this.editor === e) { e.saving = false; e.error = (error as Error).message; this.focusNext = 'editor-save'; this.render() } }
      return
    }
    if (e.newName || e.renameId) { e.error = 'Finish adding or renaming the group before saving.'; this.render(); return }
    if (e.deleting) { e.error = 'Confirm or cancel the group deletion before saving.'; this.render(); return }
    let draft = e.draft
    try {
      if (e.kind === 'add') {
        if (!e.selected) { e.error = 'Select a location before saving.'; this.render(); return }
        draft = stageFavoritesDraft(draft, { type: 'favorite:add', kind: e.selected.kind, path: e.selected.path, groupId: e.groupId }, this.snapshot!.platform)
      } else if (e.kind === 'move') draft = stageFavoritesDraft(draft, { type: 'favorite:move', favoriteId: e.favorite!.id, groupId: e.groupId }, this.snapshot!.platform)
      e.saving = true; e.error = undefined; this.render()
      const saved = await this.actions.commit(draft)
      if (this.disposed || this.editor !== e) return
      this.snapshot = { ...this.snapshot!, state: saved }; this.closeEditor()
    } catch (error) { if (!this.disposed && this.editor === e) { e.saving = false; e.error = (error as Error).message; this.focusNext = 'editor-save'; this.render() } }
  }
  private preserveComposition(input: HTMLInputElement) {
    input.addEventListener('compositionstart', () => { this.composing = true })
    input.addEventListener('compositionend', () => { this.composing = false; this.render() })
  }
  private moveDrag(event: PointerEvent) {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return
    drag.x = event.clientX; drag.y = event.clientY; this.locateDrag()
    if (!this.dragFrame && typeof requestAnimationFrame === 'function') this.dragFrame = requestAnimationFrame(() => this.scrollDrag())
  }
  private locateDrag() {
    const drag = this.drag; if (!drag) return
    const body = this.container.querySelector<HTMLElement>('.qa-page-body')!, bounds = body.getBoundingClientRect()
    drag.valid = drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom
    drag.target = undefined; this.container.querySelectorAll('.qa-drop-before, .qa-drop-after').forEach(node => node.classList.remove('qa-drop-before', 'qa-drop-after'))
    const rows = drag.list === 'groups' ? '.qa-edit-group' : '.qa-root-item'
    if (drag.valid) for (const row of this.container.querySelectorAll<HTMLElement>(rows)) {
      const id = drag.list === 'groups' ? row.dataset.groupId : row.dataset.rootId
      if (id === UNGROUPED_GROUP_ID && drag.list === 'groups') continue
      const rect = row.getBoundingClientRect()
      if (drag.y >= rect.top && drag.y <= rect.bottom) { drag.target = id; drag.after = drag.y > (rect.top + rect.bottom) / 2; row.classList.add(drag.after ? 'qa-drop-after' : 'qa-drop-before'); break }
    }
  }
  private scrollDrag() {
    this.dragFrame = undefined
    const drag = this.drag, body = this.container.querySelector<HTMLElement>('.qa-page-body'); if (!drag?.valid || !body) return
    const rect = body.getBoundingClientRect(); const delta = drag.y < rect.top + 35 ? -8 : drag.y > rect.bottom - 35 ? 8 : 0
    if (delta) {
      const previous = body.scrollTop; body.scrollTop += delta; this.locateDrag()
      if (body.scrollTop !== previous) this.dragFrame = requestAnimationFrame(() => this.scrollDrag())
    }
  }
  private endDrag(event: PointerEvent) {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return
    this.moveDrag(event)
    const valid = drag.valid && drag.target && drag.target !== drag.id; const target = drag.target, after = drag.after, id = drag.id
    this.cancelDrag()
    if (!valid || !this.editor) return
    const insert = <T>(items: T[], key: (item: T) => string) => {
      const moving = items.find(item => key(item) === id), rest = items.filter(item => key(item) !== id)
      const index = rest.findIndex(item => key(item) === target)
      if (moving === undefined || index < 0) return items
      rest.splice(index + (after ? 1 : 0), 0, moving); return rest
    }
    const roots = this.editor.roots
    // Roots are not a Favorites draft: the page keeps them until Save.
    if (drag.list === 'roots' && roots) { roots.paths = insert(roots.paths, path => this.rootId(path)); this.render() }
    else if (drag.list === 'groups') this.stage({ type: 'group:reorder', groupIds: insert(this.projected().groupOrder, group => group) })
  }
  private cancelDrag() {
    this.drag = undefined
    if (this.dragFrame !== undefined) cancelAnimationFrame(this.dragFrame)
    this.dragFrame = undefined
    this.container.querySelectorAll('.qa-dragging, .qa-drop-before, .qa-drop-after').forEach(node => node.classList.remove('qa-dragging', 'qa-drop-before', 'qa-drop-after'))
  }
}
