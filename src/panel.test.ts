// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyOperation, createState, locationId, type State } from './model'
import { icon, QuickAccessPanelRenderer } from './panel'

afterEach(() => { document.body.replaceChildren() })
function fixture() {
  let state = createState()
  for (const [kind, path, at] of [
    ['folder', '/Projects/Notes', 10], ['folder', '/Projects/Archive', 8],
    ['file', '/Projects/Notes/README.md', 10], ['file', '/Projects/Notes-old/README.md', 8],
  ] as const) state = applyOperation(state, { type: 'visit', kind, path, at }, 'darwin')
  state = applyOperation(state, { type: 'pin', kind: 'folder', path: '/Projects/Notes', pinned: true }, 'darwin')
  const mount = document.createElement('div'); document.body.append(mount)
  const actions = {
    change: vi.fn((operation) => { state = applyOperation(state, operation, 'darwin'); render() }),
    open: vi.fn(), reveal: vi.fn(), settings: vi.fn(),
  }
  const panel = new QuickAccessPanelRenderer(mount, actions)
  const render = () => panel.update({ state, platform: 'darwin', current: { file: '/Projects/Notes/README.md', folder: '/Projects/Notes' } })
  render()
  const click = (key: string) => [...mount.querySelectorAll<HTMLButtonElement>('button')].find(n => n.dataset.key === key)!.click()
  const search = (query: string) => {
    const input = mount.querySelector<HTMLInputElement>('input[type=search]')!
    input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return { mount, panel, actions, click, search, state: () => state, setState: (next: State) => { state = next; render() } }
}

describe('shared Quick Access panel', () => {
  it('gives ribbon icons standalone dimensions and line styling outside panel CSS', () => {
    const svg = icon('bookmark')
    expect(svg.getAttribute('width')).toBe('18')
    expect(svg.getAttribute('height')).toBe('18')
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
  })
  it('keeps the input connected through IME composition and background updates', () => {
    const f = fixture()
    const input = f.mount.querySelector<HTMLInputElement>('[data-key=search]')!
    input.focus(); input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.value = '日本'; input.dispatchEvent(new InputEvent('input', { isComposing: true }))
    expect(input.isConnected).toBe(true)
    f.setState(applyOperation(f.state(), { type: 'pin', kind: 'folder', path: '/Projects/日本語', pinned: true }, 'darwin'))
    expect(input.isConnected).toBe(true)
    input.value = '日本語'; input.dispatchEvent(new CompositionEvent('compositionend'))
    expect(f.mount.querySelector<HTMLInputElement>('[data-key=search]')!.value).toBe('日本語')
    expect(f.mount.querySelectorAll('.qa-row')).toHaveLength(1)
  })
  it('pins once, keeps visit timestamp and keyboard focus when rows move', () => {
    const f = fixture(); const id = locationId('folder', '/Projects/Archive', 'darwin')
    const pin = [...f.mount.querySelectorAll<HTMLButtonElement>('button')].find(n => n.dataset.key === `pin:${id}`)!
    pin.focus(); pin.click()
    expect(f.state().items.find(n => n.id === id)).toMatchObject({ pinned: true, lastVisited: 8 })
    expect(f.mount.querySelectorAll(`[data-location="${id}"]`)).toHaveLength(1)
    expect((document.activeElement as HTMLElement).dataset.key).toBe(`pin:${id}`)
  })
  it('filters files by the real root boundary and restores collapsed sections after search', () => {
    const f = fixture(); f.click('tab-file'); f.click('section-recent')
    expect(f.mount.querySelectorAll('.qa-row')).toHaveLength(0)
    f.search('README'); expect(f.mount.querySelectorAll('.qa-row')).toHaveLength(2)
    const filter = f.mount.querySelector<HTMLInputElement>('[data-key=scope]')!
    filter.checked = true; filter.dispatchEvent(new Event('change'))
    expect(f.mount.querySelectorAll('.qa-row')).toHaveLength(1)
    f.search(''); expect(f.mount.querySelectorAll('.qa-row')).toHaveLength(0)
  })
  it('offers search recovery into the other tab and never marks focus as Current', () => {
    const f = fixture(); f.search('README')
    expect(f.mount.querySelector('[data-key=other-tab]')?.textContent).toBe('2 in Files')
    f.click('other-tab'); expect(f.state().preferences.tab).toBe('file')
    expect(f.mount.querySelectorAll('[aria-label="Current file"]')).toHaveLength(1)
    expect(f.mount.querySelector('[aria-current="location"]')?.getAttribute('aria-label')).toContain('README.md')
    f.click('open:' + locationId('file', '/Projects/Notes-old/README.md', 'darwin'))
    expect(f.actions.open).toHaveBeenCalledWith('file', '/Projects/Notes-old/README.md')
    expect(f.mount.querySelectorAll('[aria-label="Current file"]')).toHaveLength(1)
  })
  it('preserves search input and caret, safely renders names, exposes all row actions', () => {
    const f = fixture(); const input = f.mount.querySelector<HTMLInputElement>('[data-key=search]')!
    input.focus(); input.value = 'Notes'; input.setSelectionRange(2, 2); input.dispatchEvent(new Event('input'))
    const refreshed = f.mount.querySelector<HTMLInputElement>('[data-key=search]')!
    expect(document.activeElement).toBe(refreshed); expect(refreshed.selectionStart).toBe(2)
    expect(f.mount.querySelector('[aria-label^="Open in Finder"]')).not.toBeNull()
    f.setState(applyOperation(f.state(), { type: 'pin', kind: 'folder', path: '/Projects/<img onerror=alert(1)>', pinned: true }, 'darwin'))
    f.search(''); expect(f.mount.querySelector('img')).toBeNull()
  })
  it('supports keyboard tabs, settings, empty states and disposal', () => {
    const f = fixture(); const tab = f.mount.querySelector<HTMLButtonElement>('[data-key=tab-folder]')!
    tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(f.state().preferences.tab).toBe('file')
    expect((document.activeElement as HTMLElement).dataset.key).toBe('tab-file')
    f.click('settings'); expect(f.actions.settings).toHaveBeenCalledOnce()
    f.setState(createState()); expect(f.mount.textContent).toContain('Pin the current folder')
    f.panel.dispose(); expect(f.mount.childElementCount).toBe(0)
  })
})
