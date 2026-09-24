// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyFavoritesOperation, createFavoritesState, UNGROUPED_GROUP_ID } from './model'
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
    expect(layout.value).toBe('tabs')
    dispose(); expect(container.childElementCount).toBe(0)
  })
})
