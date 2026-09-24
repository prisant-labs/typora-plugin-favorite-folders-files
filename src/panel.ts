import { locationId, selectLocations, type Location, type LocationKind, type Operation, type Platform, type State } from './model'

export interface PanelSnapshot {
  state: State
  platform: Platform
  current: { file?: string; folder?: string }
  unavailable?: ReadonlySet<string>
  error?: string
}
export interface PanelActions {
  change(operation: Operation): void | Promise<void>
  open(kind: LocationKind, path: string): void | Promise<void>
  reveal(kind: LocationKind, path: string): void | Promise<void>
  settings(): void
}
const paths: Record<string, string> = {
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z',
  groups: 'M4 4h5v5H4Z M15 4h5v5h-5Z M4 15h5v5H4Z M15 15h5v5h-5Z',
  more: 'M5 12h.1 M12 12h.1 M19 12h.1', back: 'M20 12H4 m6-6-6 6 6 6',
  up: 'm6 14 6-6 6 6', down: 'm6 10 6 6 6-6',
  edit: 'm4 16 12-12 4 4L8 20H4Z M14 6l4 4', trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  grip: 'M9 4h.1 M15 4h.1 M9 9h.1 M15 9h.1 M9 14h.1 M15 14h.1 M9 19h.1 M15 19h.1',
  bookmark: 'M5 3h14v18l-7-4-7 4Z M9 8h6 M9 11h4',
  folder: 'M3 6h6l2 2h10v12H3Z', file: 'M6 3h8l4 4v14H6Z M14 3v5h4 M9 12h6 M9 16h6',
  pin: 'M8 3h8l-1 7 3 4H6l3-4Z M12 14v7', search: 'M15 15l5 5 M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
  chevron: 'm5 9 7 7 7-7', clock: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0 M12 7v5l3 2',
  name: 'M3 10 6 3 9 10 M4 7h4 M3 14h6l-6 7h6 M17 4v16 M13 16l4 4 4-4',
  reveal: 'M3 8V5h6l2 3h2 M3 8v12h14l4-8H7l-4 8 M16 3h5v5 M21 3l-7 7',
  plus: 'M12 5v14 M5 12h14', settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  views: 'M4 5h16v14H4Z M4 10h16 M10 10v9',
}
export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  // Ribbon icons live outside the panel's scoped CSS.
  for (const [name, value] of Object.entries({ width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(name, value)
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', paths[name] || paths.folder)
  svg.append(path)
  return svg
}
export function favoritesRibbonIcon(): SVGSVGElement {
  const svg = icon('star')
  svg.classList.add('qa-ribbon-icon')
  svg.setAttribute('width', '24'); svg.setAttribute('height', '24')
  return svg
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function button(label: string, key: string, action: () => void, glyph?: string): HTMLButtonElement {
  const node = element('button', glyph ? 'qa-icon-button' : '')
  node.type = 'button'; node.title = label
  node.setAttribute('aria-label', label); node.dataset.key = key
  if (glyph) node.append(icon(glyph)); else node.textContent = label
  node.addEventListener('click', action)
  return node
}

/** Shared unchanged by the native panel and the self-contained visual anchor. */
export class QuickAccessPanelRenderer {
  private snapshot?: PanelSnapshot
  private query = ''
  private details?: string
  private disposed = false
  private composing = false
  constructor(private container: HTMLElement, private actions: PanelActions) {
    container.classList.add('quick-access')
    container.setAttribute('aria-label', 'Quick Access')
  }
  dispose() { this.disposed = true; this.container.replaceChildren() }
  update(snapshot: PanelSnapshot) {
    if (this.disposed) return
    this.snapshot = snapshot; this.render()
  }
  private run(action: () => void | Promise<void>) {
    const fail = (error: unknown) => {
      if (this.snapshot) this.update({ ...this.snapshot, error: error instanceof Error ? error.message : 'The action could not be completed.' })
    }
    try { Promise.resolve(action()).catch(fail) } catch (error) { fail(error) }
  }
  private change(operation: Operation) { this.run(() => this.actions.change(operation)) }
  private render() {
    if (this.disposed || this.composing) return
    const { state, current, platform, error } = this.snapshot!
    const { preferences } = state
    const kind = preferences.tab
    const active = this.container.contains(document.activeElement) ? document.activeElement as HTMLInputElement : null
    const focusKey = active?.dataset.key
    const selection = active?.tagName === 'INPUT' && active.type === 'search' ? [active.selectionStart, active.selectionEnd] : undefined
    const scrollTop = this.container.querySelector('.qa-lists')?.scrollTop ?? 0
    const selected = selectLocations(state, { kind, query: this.query, root: current.folder ?? '', platform })
    const otherKind = kind === 'file' ? 'folder' : 'file'
    const other = selectLocations(state, { kind: otherKind, query: this.query, root: current.folder ?? '', platform })
    const header = element('header', 'qa-heading')
    header.append(element('h2', '', 'Quick Access'))
    const pinCurrent = button(`Pin current ${kind}`, 'pin-current', () => {
      const path = this.snapshot?.current[this.snapshot.state.preferences.tab]
      if (path) this.change({ type: 'pin', kind: this.snapshot!.state.preferences.tab, path, pinned: true })
    }, 'plus')
    pinCurrent.disabled = !current[kind]; header.append(pinCurrent)
    const tabs = element('div', 'qa-tabs')
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Browse locations')
    for (const tabKind of ['folder', 'file'] as const) {
      const label = tabKind === 'folder' ? 'Folders' : 'Files'
      const tab = button(label, `tab-${tabKind}`, () => this.change({ type: 'preferences', patch: { tab: tabKind } }))
      tab.prepend(icon(tabKind)); tab.id = `qa-tab-${tabKind}`
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'qa-lists')
      tab.setAttribute('aria-selected', String(kind === tabKind)); tab.tabIndex = kind === tabKind ? 0 : -1
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'folder' : event.key === 'End' ? 'file' : otherKind
        tabs.querySelector<HTMLButtonElement>(`[data-key="tab-${next}"]`)?.focus()
        this.change({ type: 'preferences', patch: { tab: next } })
      })
      tabs.append(tab)
    }
    const searchWrap = element('div', 'qa-search')
    const search = element('input', '')
    search.type = 'search'; search.dataset.key = 'search'; search.placeholder = `Find a ${kind}…`
    search.setAttribute('aria-label', 'Search names and paths'); search.value = this.query
    search.addEventListener('compositionstart', () => { this.composing = true })
    search.addEventListener('input', event => {
      this.query = search.value
      if (!(event as InputEvent).isComposing) this.render()
    })
    search.addEventListener('compositionend', () => {
      this.composing = false; this.query = search.value; this.render()
    })
    searchWrap.append(icon('search'), search)
    const filter = element('label', 'qa-filter')
    const checkbox = element('input', '')
    checkbox.type = 'checkbox'; checkbox.dataset.key = 'scope'; checkbox.checked = preferences.currentFolderOnly
    checkbox.addEventListener('change', () => this.change({ type: 'preferences', patch: { currentFolderOnly: checkbox.checked } }))
    filter.append(checkbox, document.createTextNode('Current folder only')); filter.hidden = kind !== 'file'
    const lists = element('div', 'qa-lists')
    lists.id = 'qa-lists'; lists.setAttribute('role', 'tabpanel'); lists.setAttribute('aria-labelledby', `qa-tab-${kind}`)
    if (this.query.trim()) {
      const results = element('div', 'qa-search-results')
      results.append(element('span', '', `${selected.total} ${kind} match${selected.total === 1 ? '' : 'es'}`))
      if (other.total) results.append(button(`${other.total} in ${otherKind === 'file' ? 'Files' : 'Folders'}`, 'other-tab', () => this.change({ type: 'preferences', patch: { tab: otherKind } })))
      lists.append(results)
    }
    for (const section of ['pinned', 'recent'] as const) {
      const items = selected[section]
      const expanded = Boolean(this.query.trim()) || !preferences.collapsed[kind][section]
      const wrapper = element('section', 'qa-section')
      const sectionHead = element('div', 'qa-section-head')
      const toggle = button(section === 'pinned' ? 'Pinned' : 'Recent', `section-${section}`, () => {
        const collapsed = this.snapshot!.state.preferences.collapsed
        this.change({ type: 'preferences', patch: { collapsed: { [kind]: { [section]: !collapsed[kind][section] } } } })
      })
      toggle.className = 'qa-section-toggle'; toggle.setAttribute('aria-expanded', String(expanded))
      toggle.prepend(icon('chevron')); toggle.append(element('span', 'qa-count', String(items.length)))
      sectionHead.append(toggle)
      if (section === 'pinned') {
        const mode = preferences.pinSort[kind]
        sectionHead.append(button(mode === 'recent' ? 'Pinned: recently accessed. Sort A–Z' : 'Pinned: A–Z. Sort recently accessed', 'pin-sort', () => {
          this.change({ type: 'preferences', patch: { pinSort: { [kind]: mode === 'recent' ? 'name' : 'recent' } } })
        }, mode === 'recent' ? 'clock' : 'name'))
      }
      wrapper.append(sectionHead)
      if (expanded) {
        for (const item of items) wrapper.append(this.row(item))
        if (!items.length) wrapper.append(element('p', 'qa-empty', this.query.trim() ? 'No matching locations.' : section === 'pinned' ? `Pin the current ${kind} or use a row’s pin button to keep it here.` : 'Visited locations will appear here.'))
      }
      lists.append(wrapper)
    }
    if (this.query.trim() && !selected.total) lists.append(button('Clear search', 'clear-search', () => { this.query = ''; this.render(); this.container.querySelector<HTMLInputElement>('[data-key="search"]')?.focus() }))
    const footer = element('footer', 'qa-footer')
    footer.append(icon('folder'), element('span', 'qa-current-root', current.folder || 'No folder open'))
    footer.title = current.folder || 'No folder open'
    footer.append(button('Quick Access settings', 'settings', () => this.actions.settings(), 'settings'))
    const status = element('div', 'qa-status', error || '')
    status.setAttribute('role', error ? 'alert' : 'status'); status.hidden = !error
    this.container.replaceChildren(header, tabs, searchWrap, filter, lists, status, footer)
    lists.scrollTop = scrollTop
    if (focusKey) {
      const target = [...this.container.querySelectorAll<HTMLElement>('[data-key]')].find(node => node.dataset.key === focusKey)
      ;(target || search).focus()
      if (target === search && selection) search.setSelectionRange(selection[0], selection[1])
    }
  }
  private row(item: Location) {
    const { current, platform, unavailable } = this.snapshot!
    const row = element('div', 'qa-row'); row.dataset.location = item.id
    let isCurrent = false
    const currentPath = current[item.kind]
    if (currentPath) { try { isCurrent = locationId(item.kind, currentPath, platform) === item.id } catch { /* Untitled host document. */ } }
    row.classList.toggle('qa-current', isCurrent); row.classList.toggle('qa-unavailable', unavailable?.has(item.id) ?? false)
    const open = button(`Open ${item.name}`, `open:${item.id}`, () => this.run(() => this.actions.open(item.kind, item.path)))
    open.className = 'qa-open'; open.title = item.path
    const labels = element('span', 'qa-row-label'); const name = element('span', 'qa-name', item.name)
    if (unavailable?.has(item.id)) name.append(element('span', 'qa-missing', ' · Unavailable'))
    labels.append(name, element('span', 'qa-path', item.path)); open.replaceChildren(icon(item.kind), labels)
    if (isCurrent) {
      open.setAttribute('aria-current', 'location')
      const badge = element('span', 'qa-badge', 'Current'); badge.setAttribute('aria-label', `Current ${item.kind}`); open.append(badge)
    }
    const actions = element('div', 'qa-row-actions')
    const pin = button(`${item.pinned ? 'Unpin' : 'Pin'} ${item.name}`, `pin:${item.id}`, () => this.change({ type: 'pin', kind: item.kind, path: item.path, pinned: !item.pinned }), 'pin')
    pin.setAttribute('aria-pressed', String(item.pinned))
    const manager = platform === 'darwin' ? 'Finder' : 'Explorer'
    actions.append(pin, button(`${item.kind === 'folder' ? 'Open in' : 'Reveal in'} ${manager}: ${item.name}`, `reveal:${item.id}`, () => this.run(() => this.actions.reveal(item.kind, item.path)), 'reveal'))
    const details = button(`Path details: ${item.name}`, `details:${item.id}`, () => { this.details = this.details === item.id ? undefined : item.id; this.render() })
    details.className = 'qa-icon-button'; details.textContent = '…'; details.setAttribute('aria-expanded', String(this.details === item.id))
    actions.append(details); row.append(open, actions)
    const wrapper = element('div', 'qa-row-wrapper'); wrapper.append(row)
    if (this.details === item.id) wrapper.append(element('p', 'qa-details', item.path))
    return wrapper
  }
}
