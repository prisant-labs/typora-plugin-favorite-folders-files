// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowseEntry, BrowseSource } from './browse-fs'
import { BrowseController } from './browse-runtime'
import { DEFAULT_BROWSE, normalizeBrowseRecord, type BrowseRecord } from './browse-store'
import { FavoritesPanelRenderer } from './favorites-panel'
import { applyFavoritesOperation, createFavoritesState, UNGROUPED_GROUP_ID, type FavoritesOperation } from './model'
import { replayFavoritesDraft, type FavoritesDraft } from './editor-state'
import { normalizeHistory } from './native-history'
import { icon } from './panel'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); document.body.replaceChildren(); vi.restoreAllMocks() })
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const TREE: Record<string, string[]> = {
  '/Projects': ['Atlas/', 'Beacon/', 'Roadmap.md'],
  '/Projects/Atlas': ['Research/', 'Brief.md'],
  '/Projects/Atlas/Research': [],
  '/Projects/Beacon': ['Notes.md'],
  '/Home': ['Documents/'],
  '/Home/Documents': ['Ideas.md'],
}
function entries(folder: string): BrowseEntry[] {
  const names = TREE[folder]
  if (!names) throw Object.assign(new Error('missing'), { reason: 'missing' })
  return names.map(name => name.endsWith('/') ? { kind: 'folder', name: name.slice(0, -1), path: `${folder}/${name.slice(0, -1)}` } : { kind: 'file', name, path: `${folder}/${name}` })
}

async function fixture(options: { record?: Partial<BrowseRecord>; source?: BrowseSource | null; layout?: 'tabs' | 'stacked'; chooseFolder?: (defaultPath?: string) => Promise<string | undefined> } = {}) {
  let state = createFavoritesState()
  const apply = (operation: FavoritesOperation) => { state = applyFavoritesOperation(state, operation, 'darwin') }
  apply({ type: 'favorite:add', kind: 'file', path: '/Projects/Roadmap.md', groupId: UNGROUPED_GROUP_ID })
  if (options.layout) apply({ type: 'favorites:preferences', patch: { layout: options.layout } })
  const memory = { record: normalizeBrowseRecord({ ...DEFAULT_BROWSE, roots: ['/Projects'], ...options.record }, 'darwin') }
  const store = {
    read: async () => structuredClone(memory.record),
    update: vi.fn(async (change: (record: BrowseRecord) => BrowseRecord) => { memory.record = normalizeBrowseRecord(change(structuredClone(memory.record)), 'darwin'); return structuredClone(memory.record) }),
    close: async () => {},
  }
  const source: BrowseSource = { list: vi.fn(async (folder: string) => entries(folder)), drives: vi.fn(async () => ['/Volumes/Archive']), home: () => '/Home' }
  const browse = new BrowseController(store, options.source === null ? undefined : options.source ?? source, 'darwin', { pollMilliseconds: 0 })
  const current = { file: '/Projects/Atlas/Brief.md', folder: '/Projects' }
  const container = document.createElement('div'); document.body.append(container)
  const actions = {
    change: vi.fn(async (op: FavoritesOperation) => { apply(op); render() }),
    commit: vi.fn(async (draft: FavoritesDraft) => { state = replayFavoritesDraft(state, draft, 'darwin'); render(); return state }),
    open: vi.fn(), reveal: vi.fn(), settings: vi.fn(), chooseFolder: options.chooseFolder,
    browse: {
      toggle: (key: string, path?: string) => browse.toggle(key, path), setActive: (active: boolean) => browse.setActive(active),
      setCollapsed: (collapsed: boolean) => browse.setCollapsed(collapsed), addRoot: (path: string) => browse.addRoot(path),
      removeRoot: (path: string) => browse.removeRoot(path), saveRoots: vi.fn((change: Parameters<BrowseController['saveRoots']>[0]) => browse.saveRoots(change)),
    },
  }
  const renderer = new FavoritesPanelRenderer(container, actions)
  const history = normalizeHistory({ status: 'ready', order: 'global', entries: [] }, 'darwin')
  const render = () => renderer.update({ state, current, platform: 'darwin', history, writable: true, browse: browse.snapshot })
  browse.subscribe(render); await browse.start(); await flush()
  cleanups.push(() => { renderer.dispose(); browse.dispose() })
  const button = (label: string) => {
    const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)
    if (!found) throw new Error(`Missing button: ${label}`)
    return found
  }
  const rows = () => [...container.querySelectorAll<HTMLElement>('.qa-tree-open, .qa-tree-note')].map(node => node.classList.contains('qa-tree-note') ? `~${node.textContent}` : `${node.dataset.depth}:${node.querySelector('.qa-name')!.firstChild!.textContent}`)
  const click = async (label: string) => { button(label).click(); await flush() }
  return { container, actions, browse, source, memory, store, renderer, button, rows, click, render, get state() { return state } }
}

describe('Browse tab', () => {
  it('adds a third tab that never changes the saved Favorites tab', async () => {
    const f = await fixture()
    expect([...f.container.querySelectorAll('[role=tab]')].map(node => node.textContent)).toEqual(['Favorites', 'Recent', 'Browse'])
    await f.click('Browse')
    expect(f.memory.record.active).toBe(true)
    expect(f.state.preferences.activeTab).toBe('favorites')
    expect(f.button('Browse').getAttribute('aria-selected')).toBe('true')
    expect(f.button('Favorites').getAttribute('aria-selected')).toBe('false')
    await f.click('Recent')
    expect(f.memory.record.active).toBe(false); expect(f.state.preferences.activeTab).toBe('recent')
  })

  it('moves between all three tabs with the arrow, Home and End keys', async () => {
    const f = await fixture()
    const key = async (tab: string, name: string) => { f.button(tab).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); await flush() }
    await key('Favorites', 'End'); expect(f.memory.record.active).toBe(true); expect(document.activeElement).toBe(f.button('Browse'))
    await key('Browse', 'ArrowRight'); expect(f.memory.record.active).toBe(false); expect(f.state.preferences.activeTab).toBe('favorites')
    await key('Favorites', 'ArrowLeft'); expect(f.memory.record.active).toBe(true)
    await key('Browse', 'ArrowLeft'); expect(f.memory.record.active).toBe(false); expect(f.state.preferences.activeTab).toBe('recent')
    await key('Recent', 'Home'); expect(f.state.preferences.activeTab).toBe('favorites')
  })

  it('shows roots, Home and Volumes, and expands one folder level per click', async () => {
    const f = await fixture({ record: { active: true } })
    expect(f.rows()).toEqual(['0:Projects', '0:Home', '0:Volumes'])
    await f.click('Expand Projects')
    expect(f.rows()).toEqual(['0:Projects', '1:Atlas', '1:Beacon', '1:Roadmap.md', '0:Home', '0:Volumes'])
    expect(f.button('Collapse Projects').getAttribute('aria-expanded')).toBe('true')
    await f.click('Expand Atlas')
    expect(f.rows()).toEqual(['0:Projects', '1:Atlas', '2:Research', '2:Brief.md', '1:Beacon', '1:Roadmap.md', '0:Home', '0:Volumes'])
    await f.click('Expand Research')
    expect(f.rows()).toContain('~No folders or Markdown files')
    await f.click('Expand Volumes')
    expect(f.rows()).toContain('1:Archive')
    expect(f.memory.record.expanded).toEqual(['folder:/Projects', 'folder:/Projects/Atlas', 'folder:/Projects/Atlas/Research', 'drives'])
    expect(f.actions.open).not.toHaveBeenCalled()
  })

  it('opens Markdown files and marks the current document', async () => {
    const f = await fixture({ record: { active: true, expanded: ['folder:/Projects', 'folder:/Projects/Atlas'] } })
    expect(f.button('Open Brief.md').closest('.qa-row')!.classList.contains('qa-current')).toBe(true)
    expect(f.button('Open Brief.md').getAttribute('aria-current')).toBe('location')
    // The folder Typora has open is marked too.
    expect(f.button('Collapse Projects').textContent).toContain('Current')
    await f.click('Open Roadmap.md')
    expect(f.actions.open).toHaveBeenCalledWith('file', '/Projects/Roadmap.md', { newWindow: false })
  })

  it('stars, reveals and opens folders in Typora from a row', async () => {
    const f = await fixture({ record: { active: true, expanded: ['folder:/Projects'] } })
    // Roadmap.md is already a Favorite.
    expect(f.button('Remove Favorite: Roadmap.md').getAttribute('aria-pressed')).toBe('true')
    await f.click('Open in Finder: Atlas')
    expect(f.actions.reveal).toHaveBeenCalledWith('folder', '/Projects/Atlas')
    await f.click('More: Atlas'); await f.click('Open in Typora')
    expect(f.actions.open).toHaveBeenCalledWith('folder', '/Projects/Atlas')
    await f.click('Add Favorite: Atlas')
    expect(f.container.querySelector('h3')?.textContent).toBe('Add Favorite')
    expect(f.container.textContent).toContain('Selected folder: Atlas')
  })

  it('adds and removes roots from a folder\'s menu', async () => {
    const f = await fixture({ record: { active: true, expanded: ['folder:/Projects'] } })
    await f.click('More: Atlas'); await f.click('Add to Browse roots')
    expect(f.memory.record.roots).toEqual(['/Projects', '/Projects/Atlas'])
    expect(f.container.querySelector('.qa-status')?.textContent).toContain('Added Atlas to Browse roots.')
    await f.click('More: Projects'); await f.click('Remove from Browse roots')
    expect(f.memory.record.roots).toEqual(['/Projects/Atlas'])
  })

  it('moves through the tree with the arrow keys', async () => {
    const f = await fixture({ record: { active: true } })
    const key = async (name: string) => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); await flush() }
    f.button('Expand Projects').focus()
    await key('ArrowRight'); expect(f.memory.record.expanded).toEqual(['folder:/Projects'])
    await key('ArrowRight'); expect(document.activeElement?.getAttribute('aria-label')).toBe('Expand Atlas')
    await key('ArrowDown'); expect(document.activeElement?.getAttribute('aria-label')).toBe('Expand Beacon')
    await key('ArrowLeft'); expect(document.activeElement?.getAttribute('aria-label')).toBe('Collapse Projects')
    await key('ArrowLeft'); expect(f.memory.record.expanded).toEqual([])
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Expand Projects')
    await key('ArrowUp'); expect(document.activeElement?.getAttribute('aria-label')).toBe('Expand Projects')
  })

  it('explains an empty Browse and a Typora window that cannot list folders', async () => {
    const empty = await fixture({ record: { active: true, roots: [], home: false, drives: false } })
    expect(empty.container.textContent).toContain('Add a root folder to browse from it.')
    await empty.click('Manage Browse roots')
    expect(empty.container.querySelector('h3')?.textContent).toBe('Manage Browse roots')
    const unavailable = await fixture({ record: { active: true }, source: null })
    expect(unavailable.container.textContent).toContain('Browsing folders isn\'t available in this Typora window.')
  })

  it('shows a folder it cannot read by name only', async () => {
    const f = await fixture({ record: { active: true, roots: ['/Gone'] } })
    await f.click('Expand Gone')
    expect(f.rows()).toContain('~Could not be read')
  })

  it('is a collapsible section in the Stacked layout', async () => {
    const f = await fixture({ layout: 'stacked' })
    expect([...f.container.querySelectorAll('.qa-section-toggle')].map(node => node.textContent)).toEqual(['Favorites', 'Recent', 'Browse'])
    expect(f.rows()).toEqual(['0:Projects', '0:Home', '0:Volumes'])
    await f.click('Browse')
    expect(f.memory.record.collapsed).toBe(true); expect(f.rows()).toEqual([])
    expect(f.state.preferences).toMatchObject({ favoritesCollapsed: false, recentCollapsed: false })
  })

  it('marks each tab and each Stacked section with its collection\'s icon', async () => {
    const shape = (svg: Element | null | undefined) => svg?.querySelector('path')?.getAttribute('d')
    const expected = ['star', 'clock', 'tree'].map(name => shape(icon(name)))
    expect(new Set(expected).size).toBe(3)
    const tabs = await fixture()
    const tabButtons = [...tabs.container.querySelectorAll('[role="tab"]')]
    expect(tabButtons.map(node => node.textContent)).toEqual(['Favorites', 'Recent', 'Browse'])
    expect(tabButtons.map(node => shape(node.querySelector(':scope > svg.qa-collection-icon')))).toEqual(expected)
    // In the Stacked layout the icon follows the chevron, which alone turns when a section collapses.
    const stacked = await fixture({ layout: 'stacked' })
    const toggles = [...stacked.container.querySelectorAll('.qa-section-toggle')]
    expect(toggles.map(node => node.textContent)).toEqual(['Favorites', 'Recent', 'Browse'])
    for (const [index, toggle] of toggles.entries()) {
      const [chevron, mark] = [...toggle.querySelectorAll(':scope > svg')]
      expect(shape(chevron)).toBe(shape(icon('chevron'))); expect(chevron!.classList.contains('qa-collection-icon')).toBe(false)
      expect(shape(mark)).toBe(expected[index]); expect(mark!.classList.contains('qa-collection-icon')).toBe(true)
    }
  })

  it('puts the roots gear at the end of the Views row while Browse is shown, where each tab keeps its own controls', async () => {
    const f = await fixture({ record: { active: true, roots: ['/Projects', '/Writing'] } })
    const gear = f.button('Manage Browse roots'), toolbar = f.container.querySelector('.qa-toolbar')!
    expect(gear.parentElement).toBe(toolbar); expect(toolbar.lastElementChild).toBe(gear)
    expect(gear.querySelector('svg')).not.toBeNull(); expect(gear.textContent).toBe('')
    // No heading row: the tree starts the Browse list.
    expect(f.container.querySelector('.qa-browse-head')).toBeNull()
    expect(f.container.querySelector('.qa-lists')!.firstElementChild!.classList.contains('qa-tree')).toBe(true)
    await f.click('Manage Browse roots')
    expect(f.container.querySelector('h3')?.textContent).toBe('Manage Browse roots')
    await f.click('Back')
    expect(document.activeElement).toBe(f.button('Manage Browse roots'))
    // Favorites and Recent have controls of their own there instead, and search results have none.
    await f.click('Recent'); expect(() => f.button('Manage Browse roots')).toThrow()
    await f.click('Favorites'); expect(() => f.button('Manage Browse roots')).toThrow()
    await f.click('Browse')
    const search = f.container.querySelector<HTMLInputElement>('input[type="search"]')!
    search.value = 'Atlas'; search.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    expect(() => f.button('Manage Browse roots')).toThrow()
  })

  it('puts the roots gear at the end of the Browse section heading in the Stacked layout, even when collapsed', async () => {
    const f = await fixture({ layout: 'stacked' })
    const heading = f.button('Manage Browse roots').closest('.qa-browse-head')!
    expect(heading.querySelector('.qa-section-toggle')?.textContent).toBe('Browse')
    expect(heading.lastElementChild).toBe(f.button('Manage Browse roots'))
    await f.click('Browse')
    expect(f.memory.record.collapsed).toBe(true)
    expect(f.button('Manage Browse roots').closest('.qa-browse-head')).not.toBeNull()
  })

  it('orders the tabs, the arrow keys and the Stacked sections by the saved tab order', async () => {
    const f = await fixture({ record: { order: ['browse', 'favorites', 'recent'] } })
    expect([...f.container.querySelectorAll('[role=tab]')].map(node => node.textContent)).toEqual(['Browse', 'Favorites', 'Recent'])
    // The saved Favorites tab stays selected; only the positions change.
    expect(f.button('Favorites').getAttribute('aria-selected')).toBe('true')
    f.button('Favorites').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await flush()
    expect(f.memory.record.active).toBe(true)
    f.button('Browse').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await flush()
    expect(f.memory.record.active).toBe(false); expect(f.state.preferences.activeTab).toBe('recent')
    const stacked = await fixture({ layout: 'stacked', record: { order: ['recent', 'browse', 'favorites'] } })
    expect([...stacked.container.querySelectorAll('.qa-section-toggle')].map(node => node.textContent)).toEqual(['Recent', 'Browse', 'Favorites'])
  })

  it('keeps the usual tab order when this window has no Browse', async () => {
    const f = await fixture({ record: { order: ['browse', 'recent', 'favorites'] } })
    f.renderer.update({ state: f.state, current: {}, platform: 'darwin', history: normalizeHistory(undefined, 'darwin'), writable: true })
    expect([...f.container.querySelectorAll('[role=tab]')].map(node => node.textContent)).toEqual(['Favorites', 'Recent'])
  })

  it('leaves Browse when Go to Favorite shows a saved location', async () => {
    const f = await fixture({ record: { active: true } })
    f.renderer.update({ state: f.state, current: { file: '/Projects/Roadmap.md' }, platform: 'darwin', history: normalizeHistory(undefined, 'darwin'), writable: true, browse: f.browse.snapshot })
    await f.click('Add Favorite'); await f.click('Go to Favorite: Roadmap.md')
    expect(f.memory.record.active).toBe(false); expect(f.state.preferences.activeTab).toBe('favorites')
  })
})

describe('Manage Browse roots', () => {
  async function open() {
    const f = await fixture({ record: { active: true, roots: ['/Projects', '/Writing'] } })
    await f.click('Manage Browse roots')
    const names = () => [...f.container.querySelectorAll('.qa-root-item .qa-edit-name')].map(node => node.textContent)
    return { ...f, names }
  }

  it('reorders, removes and adds roots, then saves them with the Home and drives choices', async () => {
    const f = await open()
    expect(f.names()).toEqual(['Projects', 'Writing', 'Home', 'Volumes'])
    expect(f.button('Move up: Projects').disabled).toBe(true)
    await f.click('Move up: Writing'); expect(f.names()).toEqual(['Writing', 'Projects', 'Home', 'Volumes'])
    await f.click('Remove root: Writing'); expect(f.names()).toEqual(['Projects', 'Home', 'Volumes'])
    const input = f.container.querySelector<HTMLInputElement>('input[aria-label="Folder path"]')!
    input.value = '/Archive/Notes/'; input.dispatchEvent(new Event('input', { bubbles: true }))
    // A new root joins the other roots, before Home and Volumes.
    await f.click('Add folder'); expect(f.names()).toEqual(['Projects', 'Notes', 'Home', 'Volumes'])
    await f.click('Hide Home')
    expect(f.container.querySelector('.qa-draft-state')?.textContent).toBe('Unsaved changes')
    await f.click('Save')
    expect(f.actions.browse.saveRoots).toHaveBeenCalledWith({ roots: ['/Projects', '/Archive/Notes'], tops: ['root', 'root', 'home', 'drives'], home: false, drives: true })
    expect(f.memory.record).toMatchObject({ roots: ['/Projects', '/Archive/Notes'], home: false, drives: true })
    expect(f.container.querySelector('h3')).toBeNull()
  })

  it('arranges Home and Volumes among the roots, and hides them instead of removing them', async () => {
    const f = await open()
    const row = (name: string) => [...f.container.querySelectorAll<HTMLElement>('.qa-root-item')].find(node => node.querySelector('.qa-edit-name')!.textContent === name)!
    expect(f.button('Move down: Volumes').disabled).toBe(true)
    expect(() => f.button('Remove root: Home')).toThrow(); expect(() => f.button('Remove root: Volumes')).toThrow()
    expect(row('Home').querySelector('.qa-root-path')?.textContent).toBe('/Home')
    await f.click('Move up: Home'); await f.click('Move up: Home')
    expect(f.names()).toEqual(['Home', 'Projects', 'Writing', 'Volumes'])
    // Hidden, Volumes keeps its place and says so; the same button shows it again.
    f.button('Hide Volumes').focus(); await f.click('Hide Volumes')
    expect(row('Volumes').classList.contains('qa-root-hidden')).toBe(true)
    expect(row('Volumes').querySelector('.qa-root-path')?.textContent).toBe('Hidden')
    expect(document.activeElement).toBe(f.button('Show Volumes'))
    await f.click('Show Volumes'); expect(row('Volumes').classList.contains('qa-root-hidden')).toBe(false)
    await f.click('Hide Volumes')
    await f.click('Save')
    expect(f.memory.record).toMatchObject({ roots: ['/Projects', '/Writing'], tops: ['home', 'root', 'root', 'drives'], home: true, drives: false })
    expect(f.rows()).toEqual(['0:Home', '0:Projects', '0:Writing'])
  })

  it('separates the ways to add a root from the list under their own heading', async () => {
    const f = await fixture({ record: { active: true, roots: ['/Writing'] }, chooseFolder: async () => undefined })
    await f.click('Manage Browse roots')
    const headings = [...f.container.querySelectorAll('.qa-page-section')]
    expect(headings.map(node => node.textContent)).toEqual(['Roots', 'Add a root'])
    const after = (node: Element, target: Element) => Boolean(node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING)
    for (const control of [f.button('Choose folder…'), f.button('Add current folder: Projects'), f.button('Add folder')]) {
      expect(after(control, headings[1]!)).toBe(true)
    }
    for (const item of f.container.querySelectorAll('.qa-root-item')) expect(after(headings[1]!, item)).toBe(true)
  })

  it('keeps Home in the list when this window cannot say where it is', async () => {
    const source: BrowseSource = { list: vi.fn(async (folder: string) => entries(folder)), drives: vi.fn(async () => []), home: () => undefined }
    const f = await fixture({ record: { active: true }, source })
    await f.click('Manage Browse roots')
    const home = [...f.container.querySelectorAll<HTMLElement>('.qa-root-item')].find(node => node.querySelector('.qa-edit-name')!.textContent === 'Home')!
    expect(home.querySelector('.qa-root-path')?.textContent).toBe('Not known in this Typora window')
  })

  it('reorders roots by dragging a grip, and saves only on Save', async () => {
    const f = await fixture({ record: { active: true, roots: ['/Projects', '/Writing', '/Archive'] } })
    await f.click('Manage Browse roots')
    const names = () => [...f.container.querySelectorAll('.qa-root-item .qa-edit-name')].map(node => node.textContent)
    // Each redraw builds new elements, so their places are given again before each drag.
    const place = () => {
      vi.spyOn(f.container.querySelector<HTMLElement>('.qa-page-body')!, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 280, top: 0, bottom: 400 } as DOMRect)
      ;[...f.container.querySelectorAll<HTMLElement>('.qa-root-item')].forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 280, top: 40 + index * 50, bottom: 90 + index * 50 } as DOMRect))
    }
    const pointer = (type: string, y: number) => new MouseEvent(type, { bubbles: true, clientX: 12, clientY: y })
    place()
    expect(f.button('Drag root: Archive').classList.contains('qa-drag-handle')).toBe(true)
    // Drop Archive on the lower half of Projects: it lands second.
    f.button('Drag root: Archive').dispatchEvent(pointer('pointerdown', 160))
    document.dispatchEvent(pointer('pointermove', 80)); document.dispatchEvent(pointer('pointerup', 80))
    expect(names()).toEqual(['Projects', 'Archive', 'Writing', 'Home', 'Volumes'])
    expect(f.memory.record.roots).toEqual(['/Projects', '/Writing', '/Archive'])
    // Escape and a drop outside the page change nothing.
    place(); f.button('Drag root: Projects').dispatchEvent(pointer('pointerdown', 60))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.dispatchEvent(pointer('pointerup', 150))
    f.button('Drag root: Projects').dispatchEvent(pointer('pointerdown', 60))
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: -50, clientY: -50 }))
    expect(names()).toEqual(['Projects', 'Archive', 'Writing', 'Home', 'Volumes'])
    expect(f.container.querySelector('.qa-dragging')).toBeNull()
    // Volumes drags like a root: drop it on the upper half of Projects, and it leads.
    place(); f.button('Drag root: Volumes').dispatchEvent(pointer('pointerdown', 260))
    document.dispatchEvent(pointer('pointermove', 50)); document.dispatchEvent(pointer('pointerup', 50))
    expect(names()).toEqual(['Volumes', 'Projects', 'Archive', 'Writing', 'Home'])
    await f.click('Save')
    expect(f.memory.record).toMatchObject({ roots: ['/Projects', '/Archive', '/Writing'], tops: ['drives', 'root', 'root', 'root', 'home'] })
  })

  it('offers the current folder unless it is already a root', async () => {
    const f = await open()
    expect(() => f.button('Add current folder: Projects')).toThrow()
    await f.click('Remove root: Projects')
    await f.click('Add current folder: Projects'); expect(f.names()).toEqual(['Writing', 'Projects', 'Home', 'Volumes'])
  })

  it('rejects a relative or repeated path beside the path field, and keeps the typed text', async () => {
    const f = await open()
    const field = () => f.container.querySelector<HTMLInputElement>('input[aria-label="Folder path"]')!
    const type = (value: string) => { field().value = value; field().dispatchEvent(new Event('input', { bubbles: true })) }
    const error = () => f.container.querySelector<HTMLElement>('.qa-page-error')
    type('Notes'); await f.click('Add folder')
    expect(error()?.textContent).toContain('full folder path')
    expect(error()?.getAttribute('role')).toBe('alert')
    // The message sits directly below the path field, never at the bottom of the page.
    expect(error()?.previousElementSibling?.contains(field())).toBe(true)
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(field().value).toBe('Notes')
    // Typing clears it.
    type('Notes/'); expect(error()).toBeNull(); expect(field().hasAttribute('aria-invalid')).toBe(false)
    type('/Projects/'); await f.click('Add folder')
    expect(error()?.textContent).toBe('That folder is already a root.')
    expect(error()?.previousElementSibling?.contains(field())).toBe(true)
    // Unadded text blocks Save, like an unfinished group name, and says so at the field.
    type('/Archive'); await f.click('Save')
    expect(f.actions.browse.saveRoots).not.toHaveBeenCalled()
    expect(error()?.textContent).toBe('Add the folder, or clear the path, before saving.')
    expect(error()?.previousElementSibling?.contains(field())).toBe(true)
    expect(document.activeElement).toBe(field())
  })

  it('adds a root with Typora\'s folder chooser, starting at the open folder', async () => {
    const replies: Array<string | undefined> = ['/Archive/Notes', undefined, '/Projects/']
    const chooseFolder = vi.fn(async () => replies.shift())
    const f = await fixture({ record: { active: true, roots: ['/Projects', '/Writing'] }, chooseFolder })
    await f.click('Manage Browse roots')
    const names = () => [...f.container.querySelectorAll('.qa-root-item .qa-edit-name')].map(node => node.textContent)
    await f.click('Choose folder…')
    expect(chooseFolder).toHaveBeenCalledWith('/Projects')
    expect(names()).toEqual(['Projects', 'Writing', 'Notes', 'Home', 'Volumes'])
    expect(f.actions.browse.saveRoots).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(f.button('Choose folder…'))
    // Cancelling the dialog changes nothing and says nothing.
    await f.click('Choose folder…')
    expect(names()).toEqual(['Projects', 'Writing', 'Notes', 'Home', 'Volumes']); expect(f.container.querySelector('.qa-page-error')).toBeNull()
    await f.click('Choose folder…')
    const error = f.container.querySelector<HTMLElement>('.qa-page-error')!
    expect(error.textContent).toBe('That folder is already a root.')
    // The chooser and the path field share one place for their messages: right below them.
    expect(error.previousElementSibling?.querySelector('input[aria-label="Folder path"]')).not.toBeNull()
    await f.click('Save')
    expect(f.memory.record.roots).toEqual(['/Projects', '/Writing', '/Archive/Notes'])
  })

  it('reports a folder chooser that fails, and hides it where Typora offers none', async () => {
    const f = await fixture({ record: { active: true }, chooseFolder: async () => { throw new Error('bridge gone') } })
    await f.click('Manage Browse roots'); await f.click('Choose folder…')
    expect(f.container.querySelector('.qa-page-error')?.textContent).toBe('Typora\'s folder chooser could not be opened. Type the folder\'s full path instead.')
    const none = await fixture({ record: { active: true } })
    await none.click('Manage Browse roots')
    expect(() => none.button('Choose folder…')).toThrow()
  })

  it('reports a failed save beside the Save button and keeps the page open', async () => {
    const f = await open()
    f.actions.browse.saveRoots.mockRejectedValueOnce(new Error('Browse settings could not be saved.'))
    await f.click('Remove root: Writing'); await f.click('Save')
    const error = f.container.querySelector<HTMLElement>('.qa-page-error')!
    expect(error.textContent).toBe('Browse settings could not be saved.')
    expect(error.closest('.qa-page-footer')).not.toBeNull()
    expect(f.container.querySelector('h3')?.textContent).toBe('Manage Browse roots')
    expect(f.names()).toEqual(['Projects', 'Home', 'Volumes'])
  })

  it('asks before discarding changes', async () => {
    const f = await open()
    await f.click('Remove root: Projects'); await f.click('Back')
    expect(f.container.textContent).toContain('Discard changes?')
    await f.click('Discard changes')
    expect(f.memory.record.roots).toEqual(['/Projects', '/Writing'])
    expect(f.container.querySelector('h3')).toBeNull()
  })
})
