// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoritesPanelRenderer } from './favorites-panel'
import { applyFavoritesOperation, createFavoritesState, UNGROUPED_GROUP_ID, type FavoritesOperation } from './model'
import { replayFavoritesDraft, type FavoritesDraft } from './editor-state'
import { normalizeHistory } from './native-history'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); document.body.replaceChildren(); document.body.classList.remove('native-window'); vi.restoreAllMocks() })
function fixture() {
  let state = createFavoritesState()
  const apply = (operation: FavoritesOperation) => { state = applyFavoritesOperation(state, operation, 'darwin') }
  apply({ type: 'group:create', id: 'work', name: 'Projects' })
  apply({ type: 'group:create', id: 'writing', name: 'Writing' })
  for (const [kind, path, groupId] of [['folder', '/Fixture/Atlas', 'work'], ['file', '/Fixture/Atlas/Brief.md', 'work'], ['file', '/Fixture/Essay.md', 'writing']] as const) apply({ type: 'favorite:add', kind, path, groupId })
  const current = { file: '/Fixture/Ideas.md', folder: '/Fixture/Research' }
  const history = normalizeHistory({ status: 'ready', order: 'global', entries: [{ kind: 'file', path: '/Fixture/Atlas/Brief.md' }, { kind: 'file', path: '/Fixture/Recent.md' }] }, 'darwin')
  const container = document.createElement('div'); document.body.append(container)
  const actions = {
    change: vi.fn(async (op: FavoritesOperation) => { apply(op); render() }),
    commit: vi.fn(async (draft: FavoritesDraft) => { state = replayFavoritesDraft(state, draft, 'darwin'); render(); return state }),
    open: vi.fn(), reveal: vi.fn(), settings: vi.fn(),
  }
  const renderer = new FavoritesPanelRenderer(container, actions)
  const render = () => renderer.update({ state, current, platform: 'darwin', history, writable: true })
  render(); cleanups.push(() => renderer.dispose())
  const button = (label: string) => {
    const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)
    if (!found) throw new Error(`Missing button: ${label}`)
    return found
  }
  const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const setInput = (label: string, value: string) => { const node = input(label); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })) }
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  return { container, actions, renderer, current, render, button, input, setInput, flush, apply, get state() { return state } }
}

describe('Favorites production panel', () => {
  it('does not inherit Typora global fixed header/footer chrome rules', () => {
    const style = document.createElement('style')
    style.textContent = 'header{position:fixed;height:28px;top:0;z-index:900} .native-window header{height:0} footer{position:fixed;bottom:0}'
    document.body.append(style); document.body.classList.add('native-window')
    const f = fixture()
    expect(getComputedStyle(f.container.querySelector('.qa-heading')!).position).not.toBe('fixed')
    expect(f.container.querySelectorAll('header,footer')).toHaveLength(0)
    f.button('Manage groups').click(); expect(f.container.querySelectorAll('header,footer')).toHaveLength(0)
    document.body.classList.remove('native-window')
  })
  it('shows Typora Recent live with Files first, no All filter, and no snapshot controls', async () => {
    const f = fixture()
    const state = applyFavoritesOperation(f.state, { type: 'favorites:preferences', patch: { activeTab: 'recent' } }, 'darwin')
    const base = { state, current: f.current, platform: 'darwin' as const, writable: true }
    f.renderer.update({ ...base, history: normalizeHistory(undefined, 'darwin'), historySource: { available: true, loading: true } })
    expect(f.container.querySelector('[data-recent-order]')?.textContent).toBe('Loading…')
    expect(f.container.textContent).toContain('Reading Typora\'s Recent list')
    const history = normalizeHistory({ status: 'ready', order: 'global', entries: [{ kind: 'folder', path: '/Fixture/Recent' }, { kind: 'file', path: '/Fixture/Recent.md' }] }, 'darwin')
    f.renderer.update({ ...base, history, historySource: { available: true, loading: false } })
    expect([...f.container.querySelectorAll('.qa-recent-filters button')].map(node => node.textContent)).toEqual(['Files', 'Folders'])
    expect(f.button('Files').getAttribute('aria-pressed')).toBe('true')
    expect(f.container.querySelectorAll('.qa-row')).toHaveLength(1)
    expect(f.container.querySelector('[data-key="history-import"], [data-key="history-clear"], [data-key="recent-all"]')).toBeNull()
    const order = f.container.querySelector<HTMLElement>('[data-recent-order]')!
    expect(order.textContent).toBe('Most recent first'); expect(order.title).toContain('never saves')
    f.button('Folders').click(); await f.flush()
    expect(f.state.preferences.recentFilter).toBe('folder')
  })
  it('shows Files for a stored All filter and explains an unavailable Recent source', () => {
    const f = fixture()
    const state = applyFavoritesOperation(f.state, { type: 'favorites:preferences', patch: { activeTab: 'recent', recentFilter: 'all' } }, 'darwin')
    f.renderer.update({ state, current: f.current, platform: 'darwin', writable: true, history: normalizeHistory(undefined, 'darwin'), historySource: { available: false, loading: false } })
    expect(f.button('Files').getAttribute('aria-pressed')).toBe('true')
    expect(f.container.textContent).toContain('available in Typora for Windows only')
  })
  it('calls only a dated list most recent first and explains an unavailable Recently opened sort', () => {
    const f = fixture()
    const state = applyFavoritesOperation(f.state, { type: 'favorites:preferences', patch: { activeTab: 'recent' } }, 'darwin')
    const perKind = normalizeHistory({ status: 'ready', order: 'per-kind', entries: [{ kind: 'file', path: '/Fixture/Recent.md' }] }, 'darwin')
    f.renderer.update({ state, current: f.current, platform: 'darwin', writable: true, history: perKind, historySource: { available: true, loading: false } })
    expect(f.container.querySelector('[data-recent-order]')?.textContent).toBe('Typora\'s order')
    f.renderer.update({ state: f.state, current: f.current, platform: 'darwin', writable: true, history: perKind })
    f.button('Items: A-Z').click()
    expect(f.container.querySelector('.qa-sort-options')?.textContent).toContain('have no date')
  })
  it('passes Ctrl+click through as a new window on Windows and says so in the tooltip', async () => {
    const f = fixture()
    f.renderer.update({ state: f.state, current: { folder: 'C:/Fixture/Open' }, platform: 'win32', writable: true, history: normalizeHistory(undefined, 'win32') })
    const open = f.container.querySelector<HTMLButtonElement>('.qa-open')!
    expect(open.title).toContain('Ctrl+click for a new window')
    open.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await f.flush()
    expect(f.actions.open).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), { newWindow: true })
    open.dispatchEvent(new MouseEvent('click', { bubbles: true })); await f.flush()
    expect(f.actions.open).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), { newWindow: false })
  })
  it('labels the Views row, matches the sort text size and separates the two sorts', () => {
    const f = fixture()
    const views = f.button('Views'); expect(views.querySelector('svg')).not.toBeNull()
    const toolbar = f.container.querySelector('.qa-toolbar')!
    expect([...toolbar.children].map(node => node.className || node.textContent)).toEqual(['Views', 'Groups: Custom', 'qa-toolbar-divider', 'Items: A-Z'])
    const css = readFileSync(join(process.cwd(), 'src', 'style.scss'), 'utf8')
    expect(css).toMatch(/\.qa-toolbar > button \{ font-size: 11px;/)
    expect(css).toMatch(/\.qa-heading h2 \{[^}]*min-height: 28px/)
  })
  it('titles the Manage groups sections and draws a visible drag grip', () => {
    const f = fixture(); f.button('Manage groups').click()
    expect([...f.container.querySelectorAll('.qa-page-section')].map(node => node.textContent)).toEqual(['Organize groups', 'New group'])
    expect(readFileSync(join(process.cwd(), 'src', 'style.scss'), 'utf8')).toMatch(/\.qa-drag-handle svg \{[^}]*stroke-width: 3/)
  })
  it('puts Stacked section headers on the group edge and ranks them above groups', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'style.scss'), 'utf8')
    const frozen = css.slice(css.indexOf('.qa-favorites {'))
    expect(frozen).toMatch(/\.qa-section-toggle \{[^}]*padding: \d+px 0 \d+px;[^}]*border-bottom: 1px solid var\(--qa-line\)[^}]*color: var\(--qa-text\)/)
    expect(frozen).toMatch(/\.qa-section-toggle ~ \.qa-section-toggle \{ margin-top: \d+px; \}/)
  })
  it('separates the View row from the collection tabs', () => {
    expect(readFileSync(join(process.cwd(), 'src', 'style.scss'), 'utf8')).toMatch(/\.qa-controls \{[^}]*border-bottom: 1px solid var\(--qa-line\)/)
  })
  it('uses frozen defaults, header controls, mixed groups, and no whole Favorites collapse in tabs', () => {
    const f = fixture()
    expect(f.container.querySelector('h2')?.textContent).toBe('Favorites')
    expect(f.button('Views')).toBeTruthy(); expect(f.button('Groups: Custom')).toBeTruthy(); expect(f.button('Items: A-Z')).toBeTruthy()
    expect(f.container.querySelectorAll('[data-location]')).toHaveLength(3)
    expect(f.container.querySelector('[data-key="collapse-favorites"]')).toBeNull()
    expect(f.container.textContent).toContain('Ungrouped')
  })
  it('applies full-label View choices and independent layout/group view preferences', async () => {
    const f = fixture(); f.button('Views').click()
    const label = [...f.container.querySelectorAll('label')].find(node => node.textContent === 'Stacked')!
    label.click(); await f.flush()
    expect(f.state.preferences.layout).toBe('stacked')
    f.button('Views').click()
    ;[...f.container.querySelectorAll('label')].find(node => node.textContent === 'Filter')!.click(); await f.flush()
    expect(f.state.preferences.groupView).toBe('filter')
    expect(f.container.querySelector('[data-key="collapse-favorites"]')).not.toBeNull()
  })
  it('deduplicates search across both collections and matches group names', () => {
    const f = fixture(); f.setInput('Search Favorites and Recent', 'Brief')
    expect(f.container.querySelectorAll('[data-location]')).toHaveLength(1)
    f.setInput('Search Favorites and Recent', 'Projects')
    expect(f.container.querySelectorAll('[data-location]')).toHaveLength(2)
  })
  it('preserves IME text and focus through snapshot updates', () => {
    const f = fixture(); const input = f.input('Search Favorites and Recent'); input.focus()
    input.dispatchEvent(new CompositionEvent('compositionstart')); input.value = '日本語'; input.dispatchEvent(new InputEvent('input', { isComposing: true }))
    f.render(); expect(f.input('Search Favorites and Recent')).toBe(input)
    input.dispatchEvent(new CompositionEvent('compositionend'))
    expect(f.input('Search Favorites and Recent').value).toBe('日本語')
    expect(document.activeElement).toBe(f.input('Search Favorites and Recent'))
  })
  it('keeps row menus scoped and separates reveal from primary open', () => {
    const f = fixture(); f.button('Reveal in Finder: Brief.md').click()
    expect(f.actions.reveal).toHaveBeenCalledWith('file', '/Fixture/Atlas/Brief.md')
    expect(f.actions.open).not.toHaveBeenCalled()
    f.button('More: Brief.md').click()
    expect(f.container.querySelector('[role="menu"]')?.textContent).toBe('Move Favorite to groupRemove from Favorites')
  })
  it('offers group-owned arrangement in Filter only for a single selected group', async () => {
    const f = fixture(); f.apply({ type: 'favorites:preferences', patch: { groupView: 'filter' } }); f.render()
    expect(f.container.querySelector('[data-key="group-more:__all__"]')).toBeNull()
    const select = f.container.querySelector<HTMLSelectElement>('[aria-label="Favorite group"]')!
    select.value = 'work'; select.dispatchEvent(new Event('change')); await f.flush()
    f.button('Group actions: Projects').click(); f.button('Arrange Favorites').click()
    expect(f.container.textContent).toContain('Arrange Favorites · Projects')
  })
  it('stages current-only Add selection until explicit Save', async () => {
    const f = fixture(); f.button('Add Favorite').click()
    const choice = f.input('Current document: Ideas.md'); expect(choice.checked).toBe(false); choice.click()
    expect(f.actions.commit).not.toHaveBeenCalled(); expect(f.state.favorites).toHaveLength(3)
    f.button('Save').click(); await f.flush()
    expect(f.state.favorites.some(row => row.path === '/Fixture/Ideas.md' && row.groupId === UNGROUPED_GROUP_ID)).toBe(true)
    expect(f.container.querySelector('.qa-editor')).toBeNull()
  })
  it('renders all-saved cards with Done and Go without opening a target', async () => {
    const f = fixture(); f.current.file = '/Fixture/Atlas/Brief.md'; f.current.folder = '/Fixture/Atlas'; f.render()
    f.button('Add Favorite').click()
    expect(f.container.querySelector('[aria-label="Save in group"]')).toBeNull()
    expect(f.container.querySelector('[data-key="editor-save"]')).toBeNull()
    expect(f.button('Done')).toBeTruthy()
    f.button('Go to Favorite: Brief.md').click(); await f.flush()
    expect(f.actions.open).not.toHaveBeenCalled()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('More: Brief.md')
  })
  it('guards dirty Cancel and retains input when Keep editing is chosen', () => {
    const f = fixture(); f.button('Manage groups').click(); f.setInput('New group name', 'Research')
    f.button('Cancel').click(); expect(f.container.textContent).toContain('Discard changes?')
    f.button('Keep editing').click(); expect(f.input('New group name').value).toBe('Research')
    f.button('Save').click(); expect(f.container.textContent).toContain('Finish adding')
    expect(f.actions.commit).not.toHaveBeenCalled()
  })
  it('creates and deletes groups in a draft, transferring members only on Save', async () => {
    const f = fixture(); f.button('Manage groups').click()
    f.setInput('New group name', 'Research'); f.button('Add group').click()
    expect(f.state.groups).toHaveLength(2)
    f.button('Delete group: Projects').click(); f.button('Delete group').click()
    expect(f.state.favorites.filter(row => row.groupId === 'work')).toHaveLength(2)
    f.button('Save').click(); await f.flush()
    expect(f.state.groups.map(row => row.name)).toEqual(['Writing', 'Research'])
    expect(f.state.favorites.filter(row => row.groupId === UNGROUPED_GROUP_ID)).toHaveLength(2)
  })
  it('keeps automatic sort on Cancel and explicitly applies Custom with manual arrangement on Save', async () => {
    const f = fixture(); f.button('Group actions: Projects').click(); f.button('Arrange Favorites').click()
    expect(f.button('Arrange manually')).toBeTruthy(); f.button('Arrange manually').click()
    f.button('Cancel').click(); f.button('Discard changes').click()
    expect(f.state.preferences.itemSort).toBe('az')
    f.button('Group actions: Projects').click(); f.button('Arrange Favorites').click(); f.button('Arrange manually').click()
    f.button('Move down: Atlas').click(); f.button('Save').click(); await f.flush()
    expect(f.state.preferences.itemSort).toBe('custom')
    expect(f.state.itemOrder.work[0]).toBe('file:/Fixture/Atlas/Brief.md')
  })
  it('retains a draft on save failure and prevents repeated Save', async () => {
    const f = fixture(); f.button('Add Favorite').click(); f.input('Current document: Ideas.md').click()
    f.actions.commit.mockRejectedValueOnce(new Error('Synthetic save failure'))
    f.button('Save').click(); f.button('Save').click(); await f.flush()
    expect(f.actions.commit).toHaveBeenCalledOnce(); expect(f.container.textContent).toContain('Synthetic save failure')
    expect(f.input('Current document: Ideas.md').checked).toBe(true)
    f.button('Save').click(); await f.flush(); expect(f.container.querySelector('.qa-editor')).toBeNull()
  })
  it('removes only a shortcut and Undo restores to Ungrouped if its group disappeared', async () => {
    const f = fixture(); f.button('More: Brief.md').click(); f.button('Remove from Favorites').click(); await f.flush()
    expect(f.state.favorites).toHaveLength(2)
    f.apply({ type: 'group:delete', groupId: 'work' }); f.render()
    f.button('Undo').click(); await f.flush()
    expect(f.state.favorites.find(row => row.path.endsWith('Brief.md'))?.groupId).toBe(UNGROUPED_GROUP_ID)
    expect(f.actions.open).not.toHaveBeenCalled()
  })
  it('shows two-line Recent without invented ages and an explicit unavailable state', async () => {
    const f = fixture(); f.button('Recent').click(); await f.flush()
    expect(f.container.querySelectorAll('[data-location]')).toHaveLength(2)
    expect(f.container.querySelector('.qa-age')).toBeNull()
    f.renderer.update({ state: f.state, current: {}, platform: 'darwin', history: normalizeHistory(undefined, 'darwin'), writable: true })
    expect(f.container.textContent).toContain('Native Recent history is not available')
  })
  it('closes popovers on Escape and restores the trigger focus', () => {
    const f = fixture(); f.button('Views').click()
    f.container.querySelector<HTMLInputElement>('.qa-popover input')!.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(f.container.querySelector('.qa-popover')).toBeNull()
    expect(document.activeElement).toBe(f.button('Views'))
  })
  it('guards dirty Go in the mixed Add state and Keep editing cancels that navigation', async () => {
    const f = fixture(); f.current.folder = '/Fixture/Atlas'; f.render(); f.button('Add Favorite').click()
    f.input('Current document: Ideas.md').click(); f.button('Go to Favorite: Atlas').click()
    expect(f.container.textContent).toContain('Discard changes?'); f.button('Keep editing').click()
    expect(f.input('Current document: Ideas.md').checked).toBe(true); expect(f.container.querySelector('.qa-editor')).not.toBeNull()
    f.button('Cancel').click(); f.button('Discard changes').click(); await f.flush()
    expect(f.state.preferences.selectedGroup).toBe('__all__'); expect(f.actions.open).not.toHaveBeenCalled()
  })
  it('preserves search, scroll and origin focus on editor cancellation', () => {
    const f = fixture(); f.setInput('Search Favorites and Recent', 'Projects')
    f.container.querySelector('.qa-lists')!.scrollTop = 73
    f.button('Manage groups').focus(); f.button('Manage groups').click(); f.button('Cancel').click()
    expect(f.input('Search Favorites and Recent').value).toBe('Projects')
    expect(f.container.querySelector('.qa-lists')!.scrollTop).toBe(73)
    expect(document.activeElement).toBe(f.button('Manage groups'))
  })
  it('requires resolving the discard guard before Save can proceed', () => {
    const f = fixture(); f.button('Add Favorite').click(); f.input('Current document: Ideas.md').click(); f.button('Cancel').click()
    expect(f.button('Save').disabled).toBe(true)
  })
  it('preserves an inline name composition while snapshots refresh', () => {
    const f = fixture(); f.button('Manage groups').click(); const input = f.input('New group name'); input.focus()
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); input.value = '日本語'; input.dispatchEvent(new InputEvent('input', { isComposing: true }))
    f.render(); expect(f.input('New group name')).toBe(input)
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    expect(f.input('New group name').value).toBe('日本語')
  })
  it('shows the source location correctly when starring a Recent row', async () => {
    const f = fixture(); f.button('Recent').click(); await f.flush(); f.button('Add Favorite: Recent.md').click()
    expect(f.container.textContent).not.toContain('Current document: Recent.md')
    expect(f.container.textContent).toContain('Recent document: Recent.md')
  })
  it('blocks edits while storage is readonly', () => {
    const f = fixture(); f.renderer.update({ state: f.state, current: f.current, platform: 'darwin', history: normalizeHistory(undefined, 'darwin'), writable: false, error: 'Storage is unreadable' })
    expect(f.button('Add Favorite').disabled).toBe(true); expect(f.button('Manage groups').disabled).toBe(true)
    expect(f.container.textContent).toContain('Storage is unreadable')
  })
  it('updates only draft group order for a valid pointer insertion and keeps Ungrouped fixed', async () => {
    const f = fixture(); f.button('Manage groups').click()
    const body = f.container.querySelector<HTMLElement>('.qa-page-body')!
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 280, top: 0, bottom: 300 } as DOMRect)
    for (const [index, row] of [...f.container.querySelectorAll<HTMLElement>('.qa-edit-group')].entries()) vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 280, top: 40 + index * 50, bottom: 90 + index * 50 } as DOMRect)
    const pointer = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
    f.button('Drag group: Projects').dispatchEvent(pointer('pointerdown', 12, 60))
    document.dispatchEvent(pointer('pointermove', 12, 130)); document.dispatchEvent(pointer('pointerup', 12, 130))
    expect(f.state.groupOrder).toEqual(['work', 'writing'])
    expect([...f.container.querySelectorAll<HTMLElement>('.qa-edit-group')].map(row => row.dataset.groupId)).toEqual(['writing', 'work', UNGROUPED_GROUP_ID])
    f.button('Save').click(); await f.flush(); expect(f.state.groupOrder).toEqual(['writing', 'work'])
  })
  it('cancels pointer arrangement on Escape and outside drop without changing a draft', () => {
    const f = fixture(); f.button('Manage groups').click()
    f.button('Drag group: Projects').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(f.container.querySelector('.qa-dragging')).toBeNull(); expect(f.button('Save').disabled).toBe(true)
    f.button('Drag group: Projects').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: -50, clientY: -50 }))
    expect(f.container.querySelector('.qa-dragging')).toBeNull(); expect(f.button('Save').disabled).toBe(true)
  })
  it('opens only the clicked Recent menu when the same Favorite appears in stacked collections', () => {
    const f = fixture(); f.apply({ type: 'favorites:preferences', patch: { layout: 'stacked' } }); f.render()
    const more = [...f.container.querySelectorAll<HTMLButtonElement>('[aria-label="More: Brief.md"]')]
    expect(more).toHaveLength(2); more[1].click()
    expect(f.container.querySelectorAll('[role="menu"]')).toHaveLength(1)
    expect(document.activeElement?.closest('.qa-row-wrapper')?.querySelector('[data-location]')?.parentElement).toBe(f.container.querySelector('[role="menu"]')?.parentElement)
    f.button('Move Favorite to group').click(); f.button('Cancel').click()
    expect(document.activeElement).toBe(f.container.querySelectorAll('[aria-label="More: Brief.md"]')[1])
  })
  it('outside dismissal leaves the pointer target connected so its click still executes', () => {
    const f = fixture(); f.button('Views').click(); const manage = f.button('Manage groups')
    manage.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(manage.isConnected).toBe(true); expect(f.container.querySelector('.qa-popover')).toBeNull()
    manage.click(); expect(f.container.querySelector('.qa-editor')).not.toBeNull()
  })
  it('keeps focus inside the editor when manual or discard controls disappear so Escape still works', () => {
    const f = fixture(); f.button('Group actions: Projects').click(); f.button('Arrange Favorites').click()
    f.button('Arrange manually').focus(); f.button('Arrange manually').click()
    expect(f.container.contains(document.activeElement)).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    f.button('Keep editing').focus(); f.button('Keep editing').click()
    expect(f.container.contains(document.activeElement)).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(f.container.textContent).toContain('Discard changes?')
  })
  it('restores keyboard focus after an asynchronous save failure', async () => {
    const f = fixture(); f.button('Add Favorite').click(); f.input('Current document: Ideas.md').click()
    let fail!: (error: Error) => void
    f.actions.commit.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    f.button('Save').focus(); f.button('Save').click(); fail(new Error('Delayed failure')); await f.flush()
    expect(f.container.contains(document.activeElement)).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(f.container.textContent).toContain('Discard changes?')
  })
  it('does not intercept text navigation keys outside the active action menu', () => {
    const f = fixture(); f.button('More: Brief.md').click()
    const search = f.input('Search Favorites and Recent'); search.focus()
    const home = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }); search.dispatchEvent(home)
    expect(home.defaultPrevented).toBe(false); expect(document.activeElement).toBe(search)
  })
  it('keeps the insertion marker aligned with the group under a stationary pointer during autoscroll', () => {
    const f = fixture()
    for (let index = 3; index <= 8; index++) f.apply({ type: 'group:create', id: `g${index}`, name: `Group ${index}` })
    f.render(); f.button('Manage groups').click()
    const body = f.container.querySelector<HTMLElement>('.qa-page-body')!
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 280, top: 0, bottom: 200 } as DOMRect)
    const rows = [...f.container.querySelectorAll<HTMLElement>('.qa-edit-group')]
    rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, right: 280, top: 40 + index * 40 - body.scrollTop, bottom: 80 + index * 40 - body.scrollTop }) as DOMRect))
    let frame: FrameRequestCallback | undefined
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(fn => { frame = fn; return 1 })
    f.button('Drag group: Projects').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 60 }))
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 12, clientY: 185 }))
    for (let index = 0; index < 8; index++) { const next = frame!; frame = undefined; next(index) }
    expect(body.scrollTop).toBe(64)
    const underPointer = rows.find(row => { const r = row.getBoundingClientRect(); return r.top <= 185 && r.bottom >= 185 })!
    expect(f.container.querySelector<HTMLElement>('.qa-drop-before, .qa-drop-after')?.dataset.groupId).toBe(underPointer.dataset.groupId)
  })
})
