// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyFavoritesOperation, createFavoritesState, UNGROUPED_GROUP_ID } from './model'
import { icon } from './panel'
import { renderSettings } from './settings-ui'
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })
describe('shared Favorites settings editor', () => {
  it('uses the compact Favorites masthead and grouped controls with honest session-only copy', () => {
    const container = document.createElement('div')
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { version: '0.1.0', author: 'Example Author', authorUrl: 'https://example.com', repo: 'example/favorites' })
    expect(container.querySelector('.qa-settings__masthead h2')?.textContent).toBe('Favorites')
    expect(container.querySelector('[data-release-status]')?.textContent).toBe('Early release')
    expect(container.textContent).toContain('Installed 0.1.0')
    expect(container.querySelector<HTMLAnchorElement>('[data-link="author"]')?.href).toBe('https://example.com/')
    expect(container.querySelector<HTMLAnchorElement>('[data-link="github"]')?.href).toBe('https://github.com/example/favorites')
    expect([...container.querySelectorAll('.qa-settings__section > h3')].map(node => node.textContent)).toEqual(['Display', 'Ordering', 'Recent'])
    expect(container.textContent).toContain('File → Open Recent')
    expect(container.textContent).toContain('never saves')
    expect(container.textContent).toContain('It is available in Typora for Windows and macOS.')
    expect(container.textContent).not.toContain('not yet been tested')
    // macOS never supplies dates, so the unavailable text must not promise that the sort will arrive.
    expect(container.querySelector('[data-recent-capability]')?.textContent).toBe('Recently opened ordering needs a date on every entry in Typora\'s Recent list. While it is unavailable, Favorites keeps your Custom order.')
    expect(container.querySelector('header, footer')).toBeNull()
    dispose()
  })

  it('separates every masthead fact, including Local folder, outside of links', () => {
    const container = document.createElement('div')
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { version: '0.1.0', author: 'Example Author', authorUrl: 'https://example.com', repo: 'example/favorites', openFolder: vi.fn() })
    const facts = [...container.querySelectorAll('.qa-settings__meta > *')]
    expect(facts.map(node => node.className)).toEqual(Array(4).fill('qa-settings__fact'))
    expect(facts.map(node => node.textContent)).toEqual(['By Example Author', 'Installed 0.1.0', 'GitHub', 'Local folder'])
    const css = readFileSync(join(process.cwd(), 'src', 'settings.scss'), 'utf8')
    expect(css).toMatch(/\.qa-settings__fact \+ \.qa-settings__fact::before \{[^}]*content: '·'/)
    expect(css).not.toContain(':not(button)')
    // Flex layout trims the space in "Installed 0.1.0" and "By <link>"; facts must stay inline text.
    expect(css).not.toMatch(/\.qa-settings__fact \{[^}]*display: (inline-)?flex/)
    dispose()
  })

  it('keeps the update pill text at full contrast and marks it with the theme accent', () => {
    // Typora's base palette sets the accent to #777; the pill must not look like a disabled control.
    const css = readFileSync(join(process.cwd(), 'src', 'settings.scss'), 'utf8')
    const pill = css.match(/\.qa-settings__update \{([^}]*)\}/)?.[1] ?? ''
    expect(pill).toMatch(/(^|;)\s*color: var\(--settings-text\)/)
    expect(pill).toMatch(/border: 1px solid var\(--update-accent\)/)
    expect(pill).toMatch(/background: color-mix\(in srgb, var\(--update-accent\) \d+%, transparent\)/)
    expect(css).toMatch(/\.qa-settings__update svg \{[^}]*color: var\(--update-accent\)/)
  })

  it('stretches the preview to the settings pane instead of a fixed panel height', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'settings.scss'), 'utf8')
    expect(css).toMatch(/\.typ-setting-tab:has\(> \.qa-settings-host\) \{ height: 100%; \}/)
    expect(css).toMatch(/\.qa-settings \.qa-settings__preview-panel \{[^}]*min-height: 460px/)
    expect(css).not.toMatch(/\.qa-settings__preview-panel \{[^}]*[^-]height: 460px/)
    expect(css).not.toContain('position: sticky')
  })

  it('opens the local folder only on request and reports errors without trusting unsafe metadata links', async () => {
    const container = document.createElement('div')
    const openFolder = vi.fn(async () => { throw new Error('Could not open folder') })
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { author: '<b>Example</b>', authorUrl: 'javascript:alert(1)', repo: 'javascript:alert(1)', openFolder })
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(openFolder).not.toHaveBeenCalled()
    container.querySelector<HTMLButtonElement>('[data-action="open-plugin-folder"]')!.click()
    await vi.waitFor(() => expect(container.textContent).toContain('Could not open folder'))
    expect(openFolder).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('does not open the local folder when disposed before its deferred action runs', async () => {
    const container = document.createElement('div')
    const openFolder = vi.fn()
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { openFolder })
    container.querySelector<HTMLButtonElement>('[data-action="open-plugin-folder"]')!.click()
    dispose()
    await Promise.resolve(); await Promise.resolve()
    expect(openFolder).not.toHaveBeenCalled()
    expect(container.childElementCount).toBe(0)
  })

  it('renders the actual Favorites panel with synthetic data and keeps preview actions in memory', async () => {
    const container = document.createElement('div'); document.body.append(container)
    const change = vi.fn()
    const state = applyFavoritesOperation(createFavoritesState(), { type: 'favorite:add', kind: 'file', path: '/Private/Unshared.md', groupId: UNGROUPED_GROUP_ID }, 'darwin')
    state.preferences.layout = 'stacked'
    const dispose = renderSettings(container, state, change)
    const preview = container.querySelector<HTMLElement>('.qa-settings__preview .qa-favorites')!
    expect(preview).not.toBeNull()
    expect(preview.querySelector('[data-key="collapse-favorites"]')).not.toBeNull()
    expect(preview.textContent).toContain('Project brief.md')
    expect(preview.innerHTML).not.toContain('Unshared')
    preview.querySelector<HTMLButtonElement>('[aria-label="Open Project brief.md"]')!.click()
    await Promise.resolve()
    expect(container.textContent).toContain('Preview only')
    preview.querySelector<HTMLButtonElement>('[data-key="collapse-favorites"]')!.click()
    await Promise.resolve()
    expect(change).not.toHaveBeenCalled()
    expect(state.favorites).toHaveLength(1)
    const removeListener = vi.spyOn(document, 'removeEventListener')
    dispose()
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(container.childElementCount).toBe(0)
  })

  it('suspends the preview when Core hides the modal without onhide and resumes it when visible', () => {
    let resized = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe() {}
      disconnect = disconnect
    })
    const container = document.createElement('div'); document.body.append(container)
    const dispose = renderSettings(container, createFavoritesState(), vi.fn())
    const root = container.querySelector<HTMLElement>('.qa-settings')!
    const rects = vi.spyOn(root, 'getClientRects').mockReturnValue([] as unknown as DOMRectList)
    resized()
    expect(container.querySelector('.qa-favorites')).toBeNull()
    rects.mockReturnValue([{}] as unknown as DOMRectList)
    resized()
    expect(container.querySelectorAll('.qa-favorites')).toHaveLength(1)
    dispose(); resized()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(container.childElementCount).toBe(0)
  })
  it('renders approved preferences and disables unavailable Recent ordering', () => {
    const container = document.createElement('div'); const change = vi.fn()
    const dispose = renderSettings(container, createFavoritesState(), change)
    expect(container.querySelectorAll('input[type=number]')).toHaveLength(0)
    const layout = container.querySelector<HTMLSelectElement>('[aria-label="Layout"]')!
    expect(layout.value).toBe('tabs')
    layout.value = 'stacked'; layout.dispatchEvent(new Event('change'))
    expect(change).toHaveBeenCalledWith({ layout: 'stacked' })
    expect(container.querySelector<HTMLOptionElement>('[aria-label="Group order"] option[value="recent"]')!.disabled).toBe(true)
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Item order"]')!.value).toBe('az')
    dispose(); expect(container.children).toHaveLength(0)
  })

  it('disables changes until persistence is writable and rejects programmatic unavailable choices', () => {
    const container = document.createElement('div'); const change = vi.fn()
    const disposeReadonly = renderSettings(container, createFavoritesState(), change, { writable: false })
    const layout = container.querySelector<HTMLSelectElement>('[aria-label="Layout"]')!
    expect(layout.disabled).toBe(true)
    layout.value = 'stacked'; layout.dispatchEvent(new Event('change'))
    expect(change).not.toHaveBeenCalled()
    disposeReadonly()
    const dispose = renderSettings(container, createFavoritesState(), change)
    const groups = container.querySelector<HTMLSelectElement>('[aria-label="Group order"]')!
    groups.value = 'recent'; groups.dispatchEvent(new Event('change'))
    expect(change).not.toHaveBeenCalled()
    dispose()
  })

  it('shows failed saves and ignores late completion after disposal', async () => {
    const container = document.createElement('div')
    const change = vi.fn(async () => { throw new Error('Cannot save setting') })
    const dispose = renderSettings(container, createFavoritesState(), change)
    const layout = container.querySelector<HTMLSelectElement>('[aria-label="Layout"]')!
    layout.value = 'stacked'; layout.dispatchEvent(new Event('change'))
    await Promise.resolve(); await Promise.resolve()
    expect(container.textContent).toContain('Cannot save setting')
    // The message belongs to the setting that failed.
    const error = layout.closest('.qa-setting-row')!.querySelector('.qa-settings__error')!
    expect(error.textContent).toBe('Cannot save setting'); expect(error.getAttribute('role')).toBe('alert')
    expect(container.querySelector<HTMLElement>('.qa-settings__status')!.hidden).toBe(true)
    expect(layout.value).toBe('tabs')
    dispose(); expect(container.childElementCount).toBe(0)
  })
})

describe('Browse settings', () => {
  type Saved = { roots: string[]; tops: Array<'root' | 'home' | 'drives'>; home: boolean; drives: boolean }
  function host(options: { platform?: 'darwin' | 'win32'; writable?: boolean; save?: (change: Saved) => Promise<unknown>; choose?: (defaultPath?: string) => Promise<string | undefined> } = {}) {
    const container = document.createElement('div'); document.body.append(container)
    const kept = { roots: ['/Projects', '/Writing'], tops: ['root', 'root', 'home', 'drives'] as Saved['tops'], home: true, drives: true, input: '', error: undefined as { at: 'roots' | 'add'; message: string } | undefined }
    const save = vi.fn(options.save ?? (async (change: Saved) => { Object.assign(kept, change); draw() }))
    let dispose = () => {}
    const draw = () => {
      dispose()
      dispose = renderSettings(container, createFavoritesState(), vi.fn(), { browse: {
        platform: options.platform ?? 'darwin', roots: kept.roots, tops: kept.tops, home: kept.home, drives: kept.drives, homeFolder: '/Home', writable: options.writable ?? true,
        current: '/Library/Research', input: kept.input, error: kept.error,
        setInput: value => { kept.input = value }, setError: error => { kept.error = error; draw() }, save, choose: options.choose,
      } })
    }
    draw()
    const section = () => container.querySelector<HTMLElement>('[data-settings-section="browse"]')!
    const button = (label: string) => section().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
    const field = () => section().querySelector<HTMLInputElement>('input[aria-label="Folder path"]')!
    const type = (value: string) => { field().value = value; field().dispatchEvent(new Event('input', { bubbles: true })) }
    const names = () => [...section().querySelectorAll('.qa-settings__root-name')].map(node => node.textContent)
    const row = (name: string) => [...section().querySelectorAll<HTMLElement>('.qa-settings__order-item')].find(node => node.querySelector('.qa-settings__root-name')?.textContent === name)!
    const error = (at: string) => section().querySelector(`[data-browse-setting="${at}"] .qa-settings__error`)?.textContent
    return { container, kept, save, section, button, field, type, names, row, error, dispose: () => dispose() }
  }

  it('gets its own section, after Recent, with the roots, Home and Volumes in one list', () => {
    const f = host()
    expect([...f.container.querySelectorAll('.qa-settings__section > h3')].map(node => node.textContent)).toEqual(['Display', 'Ordering', 'Recent', 'Browse'])
    expect([...f.section().querySelectorAll('.qa-settings__setting-name')].map(node => node.textContent)).toEqual(['Roots', 'Add a root'])
    expect(f.section().textContent).toContain('Browse shows these first, in this order.')
    expect(f.names()).toEqual(['Projects', 'Writing', 'Home', 'Volumes'])
    expect(f.row('Projects').querySelector('.qa-settings__root-path')?.textContent).toBe('/Projects')
    expect(f.row('Home').querySelector('.qa-settings__root-path')?.textContent).toBe('/Home')
    expect(f.button('Move up: Projects').disabled).toBe(true); expect(f.button('Move down: Volumes').disabled).toBe(true)
    // Home and Volumes are hidden, never removed.
    expect(f.button('Hide Home')).not.toBeNull(); expect(f.button('Hide Volumes')).not.toBeNull()
    // After a removal, focus goes to the same button on the next row, not to the other row's path field.
    expect(f.button('Remove root: Projects').dataset.settingFallback).toBe('browseRoot:folder:/Writing:remove')
    expect(f.button('Remove root: Writing').dataset.settingFallback).toBe('browseHome')
    expect(f.button('Remove root: Home')).toBeNull(); expect(f.section().querySelector('input[type="checkbox"]')).toBeNull()
    // The ways to add a root have their own row. Without a chooser, it offers the open folder and a typed path.
    const adding = f.section().querySelector('[data-browse-setting="add"]')!
    expect(adding.contains(f.field())).toBe(true); expect(adding.contains(f.button('Add current folder: Research'))).toBe(true)
    expect(f.button('Choose folder…')).toBeNull()
    f.dispose()
    const windows = host({ platform: 'win32' })
    expect(windows.button('Hide Drives')).not.toBeNull()
    expect(windows.field().placeholder).toBe('D:\\Notes')
    windows.dispose()
  })

  it('saves each move, removal and hide at once, with the other choices unchanged', async () => {
    const f = host()
    f.button('Move up: Writing').click()
    expect(f.save).toHaveBeenLastCalledWith({ roots: ['/Writing', '/Projects'], tops: ['root', 'root', 'home', 'drives'], home: true, drives: true })
    await vi.waitFor(() => expect(f.names()).toEqual(['Writing', 'Projects', 'Home', 'Volumes']))
    f.button('Move up: Home').click()
    expect(f.save).toHaveBeenLastCalledWith({ roots: ['/Writing', '/Projects'], tops: ['root', 'home', 'root', 'drives'], home: true, drives: true })
    await vi.waitFor(() => expect(f.names()).toEqual(['Writing', 'Home', 'Projects', 'Volumes']))
    f.button('Remove root: Writing').click()
    await vi.waitFor(() => expect(f.names()).toEqual(['Home', 'Projects', 'Volumes']))
    expect(f.kept.tops).toEqual(['home', 'root', 'drives'])
    f.button('Hide Home').click()
    expect(f.save).toHaveBeenLastCalledWith({ roots: ['/Projects'], tops: ['home', 'root', 'drives'], home: false, drives: true })
    await vi.waitFor(() => expect(f.row('Home').classList.contains('qa-settings__root-hidden')).toBe(true))
    expect(f.row('Home').querySelector('.qa-settings__root-path')?.textContent).toBe('Hidden')
    f.button('Show Home').click()
    expect(f.save).toHaveBeenLastCalledWith({ roots: ['/Projects'], tops: ['home', 'root', 'drives'], home: true, drives: true })
    f.dispose()
  })

  it('adds the open folder, a chosen folder or a typed path after the other roots', async () => {
    const choose = vi.fn(async () => '/Volumes/Archive')
    const f = host({ choose })
    f.button('Add current folder: Research').click()
    await vi.waitFor(() => expect(f.names()).toEqual(['Projects', 'Writing', 'Research', 'Home', 'Volumes']))
    expect(f.kept.tops).toEqual(['root', 'root', 'root', 'home', 'drives'])
    expect(f.button('Add current folder: Research')).toBeNull()
    f.button('Choose folder…').click()
    expect(choose).toHaveBeenCalledWith('/Library/Research')
    await vi.waitFor(() => expect(f.names()).toEqual(['Projects', 'Writing', 'Research', 'Archive', 'Home', 'Volumes']))
    f.type('/Notes/Inbox/'); f.field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => expect(f.names()).toEqual(['Projects', 'Writing', 'Research', 'Archive', 'Inbox', 'Home', 'Volumes']))
    expect(f.kept.input).toBe(''); expect(f.field().value).toBe('')
    f.dispose()
  })

  it('shows add errors right below the add controls and keeps the typed path', async () => {
    const replies: Array<string | undefined> = ['/Writing/']
    const f = host({ choose: async () => { if (!replies.length) throw new Error('bridge gone'); return replies.shift() } })
    f.type('Notes'); f.button('Add folder').click()
    expect(f.error('add')).toBe('Enter a full folder path, such as /Volumes/Notes.')
    const error = f.section().querySelector('[data-browse-setting="add"] .qa-settings__error')!
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.previousElementSibling?.contains(f.field())).toBe(true)
    expect(f.field().value).toBe('Notes'); expect(f.field().getAttribute('aria-invalid')).toBe('true')
    expect(f.save).not.toHaveBeenCalled()
    f.type('/Projects'); f.button('Add folder').click()
    expect(f.error('add')).toBe('That folder is already a root.')
    f.button('Choose folder…').click()
    await vi.waitFor(() => expect(f.error('add')).toBe('That folder is already a root.'))
    f.button('Choose folder…').click()
    await vi.waitFor(() => expect(f.error('add')).toBe('Typora\'s folder chooser could not be opened. Type the folder\'s full path instead.'))
    expect(f.error('roots')).toBeUndefined(); expect(f.save).not.toHaveBeenCalled()
    f.dispose()
  })

  it('reports a failed save in the row that changed and gives back the typed path', async () => {
    const f = host({ save: async () => { throw new Error('Browse settings could not be saved.') } })
    f.button('Hide Volumes').click()
    await vi.waitFor(() => expect(f.error('roots')).toBe('Browse settings could not be saved.'))
    expect(f.error('add')).toBeUndefined()
    f.type('/Notes'); f.button('Add folder').click()
    await vi.waitFor(() => expect(f.error('add')).toBe('Browse settings could not be saved.'))
    expect(f.error('roots')).toBeUndefined()
    expect(f.field().value).toBe('/Notes')
    expect(f.container.querySelector<HTMLElement>('.qa-settings__status')!.hidden).toBe(true)
    f.dispose()
  })

  it('cannot be changed until Browse settings have been read', () => {
    const f = host({ writable: false, choose: vi.fn() })
    const controls = [...f.section().querySelectorAll<HTMLInputElement | HTMLButtonElement>('button, input')]
    expect(controls.length).toBeGreaterThan(8); expect(controls.every(control => control.disabled)).toBe(true)
    f.dispose()
  })
})

describe('tab order setting', () => {
  const order = (container: HTMLElement) => [...container.querySelectorAll('[data-tab-order] .qa-settings__order-name')].map(node => node.textContent)
  const button = (container: HTMLElement, label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  const previewTabs = (container: HTMLElement) => [...container.querySelectorAll('.qa-settings__preview [role=tab]')].map(node => node.textContent)

  it('lists the tabs in Display, moves one with its buttons and saves the whole order', async () => {
    const container = document.createElement('div'); document.body.append(container)
    const setOrder = vi.fn(async () => {})
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { tabs: { order: ['favorites', 'recent', 'browse'], writable: true, setOrder } })
    const display = container.querySelector('[data-settings-section="display"]')!
    expect(display.textContent).toContain('Tab order')
    expect(display.textContent).toContain('The order of the tabs in the panel, and of the sections in the Stacked layout.')
    expect(order(container)).toEqual(['Favorites', 'Recent', 'Browse'])
    // Each tab carries the same icon as in the panel.
    const shape = (svg: Element | null) => svg?.querySelector('path')?.getAttribute('d')
    expect([...container.querySelectorAll('[data-tab-order] .qa-settings__order-item')].map(item => shape(item.querySelector(':scope > svg.qa-settings__order-icon'))))
      .toEqual(['star', 'clock', 'tree'].map(name => shape(icon(name))))
    expect(button(container, 'Move up: Favorites').disabled).toBe(true)
    expect(button(container, 'Move down: Browse').disabled).toBe(true)
    button(container, 'Move up: Browse').click()
    expect(setOrder).toHaveBeenCalledExactlyOnceWith(['favorites', 'browse', 'recent'])
    await vi.waitFor(() => expect(container.querySelector<HTMLElement>('.qa-settings__status')!.hidden).toBe(true))
    dispose()
  })

  it('shows Browse in the live preview, in the saved order', () => {
    const container = document.createElement('div'); document.body.append(container)
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { tabs: { order: ['browse', 'favorites', 'recent'], writable: true, setOrder: vi.fn() } })
    expect(previewTabs(container)).toEqual(['Browse', 'Favorites', 'Recent'])
    container.querySelector<HTMLButtonElement>('.qa-settings__preview [data-key="tab-browse"]')!.click()
    // The preview's Browse is synthetic and in memory: its folders open without reading the disk.
    const preview = container.querySelector<HTMLElement>('.qa-settings__preview')!
    expect(preview.querySelector('[aria-label="Collapse Projects"]')).not.toBeNull()
    preview.querySelector<HTMLButtonElement>('[aria-label="Expand Atlas"]')!.click()
    expect(preview.textContent).toContain('Project brief.md')
    preview.querySelector<HTMLButtonElement>('[aria-label="Open Project brief.md"]')!.click()
    expect(preview.textContent).toContain('Preview only')
    dispose()
    const plain = document.createElement('div')
    const disposePlain = renderSettings(plain, createFavoritesState(), vi.fn())
    expect(plain.querySelector('[data-tab-order]')).toBeNull()
    expect(previewTabs(plain)).toEqual(['Favorites', 'Recent', 'Browse'])
    disposePlain()
  })

  it('reports a failed save and keeps the order unchanged', async () => {
    const container = document.createElement('div'); document.body.append(container)
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { tabs: { order: ['favorites', 'recent', 'browse'], writable: true, setOrder: vi.fn(async () => { throw new Error('Browse settings could not be saved.') }) } })
    button(container, 'Move down: Favorites').click()
    await vi.waitFor(() => expect(container.querySelector('[data-tab-order] .qa-settings__error')?.textContent).toBe('Browse settings could not be saved.'))
    expect(order(container)).toEqual(['Favorites', 'Recent', 'Browse'])
    dispose()
    // A message the host kept across a redraw shows in the same row.
    const kept = document.createElement('div')
    const disposeKept = renderSettings(kept, createFavoritesState(), vi.fn(), { tabs: { order: ['favorites', 'recent', 'browse'], writable: true, setOrder: vi.fn(), error: 'Browse settings could not be saved.' } })
    expect(kept.querySelector('[data-tab-order] .qa-settings__error')?.textContent).toBe('Browse settings could not be saved.')
    disposeKept()
  })

  it('cannot be changed until Browse settings have been read', () => {
    const container = document.createElement('div'); const setOrder = vi.fn()
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { tabs: { order: ['favorites', 'recent', 'browse'], writable: false, setOrder } })
    const moves = [...container.querySelectorAll<HTMLButtonElement>('[data-tab-order] button')]
    expect(moves).toHaveLength(6); expect(moves.every(move => move.disabled)).toBe(true)
    moves[1].click(); expect(setOrder).not.toHaveBeenCalled()
    dispose()
  })
})

describe('settings updates', () => {
  it('shows an update pill beside the installed version and opens the confirmation', () => {
    const container = document.createElement('div'); document.body.append(container)
    const open = vi.fn()
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { version: '0.1.3', update: { version: '0.1.5', open } })
    const pill = container.querySelector<HTMLButtonElement>('.qa-settings__meta [data-action="update"]')!
    expect(pill.textContent).toBe('Update to 0.1.5')
    expect(pill.getAttribute('aria-label')).toBe('Update Favorites to 0.1.5')
    expect(pill.closest('.qa-settings__fact')?.textContent).toBe('Installed 0.1.3Update to 0.1.5')
    pill.click(); expect(open).toHaveBeenCalledOnce()
    dispose()
    const plain = document.createElement('div')
    renderSettings(plain, createFavoritesState(), vi.fn(), { version: '0.1.3' })()
    expect(plain.querySelector('[data-action="update"]')).toBeNull()
  })

  it('no longer claims that the page does not check for updates', () => {
    const container = document.createElement('div')
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { version: '0.1.3' })
    const badge = container.querySelector<HTMLElement>('[data-release-status]')!
    expect(badge.title).toBe('Favorites is an early release. Please report problems on GitHub.')
    dispose()
  })

  it('offers the automatic check as a setting that explains the request', async () => {
    const container = document.createElement('div'); document.body.append(container)
    const setEnabled = vi.fn(async () => {})
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { version: '0.1.3', updates: { enabled: true, setEnabled } })
    expect([...container.querySelectorAll('.qa-settings__section > h3')].map(node => node.textContent)).toEqual(['Display', 'Ordering', 'Recent', 'Updates'])
    const section = container.querySelector('[data-settings-section="updates"]')!
    expect(section.textContent).toContain('Check for updates automatically')
    expect(section.textContent).toContain('At most once a day, when this page or the Favorites panel opens, Favorites asks Community Plugin Core to check the Plugin Marketplace for a newer version.')
    expect(section.textContent).toContain('Core downloads the Marketplace\'s public lists from GitHub. Favorites sends nothing about you or your files.')
    const box = section.querySelector<HTMLInputElement>('input[type="checkbox"][data-setting-key="checkForUpdates"]')!
    expect(box.checked).toBe(true)
    box.click()
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false)
    expect(box.disabled).toBe(true)
    await vi.waitFor(() => expect(box.disabled).toBe(false))
    dispose()
  })

  it('restores the checkbox and reports a failed save', async () => {
    const container = document.createElement('div'); document.body.append(container)
    const dispose = renderSettings(container, createFavoritesState(), vi.fn(), { updates: { enabled: false, setEnabled: vi.fn(async () => { throw new Error('Cannot save setting') }) } })
    const box = container.querySelector<HTMLInputElement>('input[data-setting-key="checkForUpdates"]')!
    box.click()
    await vi.waitFor(() => expect(box.closest('.qa-setting-row')!.querySelector('.qa-settings__error')?.textContent).toBe('Cannot save setting'))
    expect(box.checked).toBe(false); expect(box.disabled).toBe(false)
    dispose()
  })
})
