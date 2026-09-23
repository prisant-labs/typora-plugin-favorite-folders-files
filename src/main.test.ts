// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyFavoritesOperation, createFavoritesState, type FavoritesOperation } from './model'
import { replayFavoritesDraft, type FavoritesDraft } from './editor-state'
vi.mock('@typora-community-plugin/core', () => import('../test/support/typora-core'))
vi.mock('./storage', () => ({ FavoritesIndexedDbStore: class {
  state = createFavoritesState()
  async read() { return this.state }
  async update(op: FavoritesOperation) { return this.state = applyFavoritesOperation(this.state, op, 'win32') }
  async commitDraft(draft: FavoritesDraft) { return this.state = replayFavoritesDraft(this.state, draft, 'win32') }
  async close() {}
} }))
import QuickAccessPlugin from './main'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren() })

describe('plugin lifecycle', () => {
  it('registers ribbon, sidebar, settings, and commands; unload removes DOM and prevents stale resurrection', async () => {
    vi.useFakeTimers()
    const unsubscribe = vi.fn(); const remove = vi.fn()
    const app = {
      platform: 'win32', openFile: vi.fn(),
      commands: { run: vi.fn() },
      vault: { path: 'C:/Synthetic', on: vi.fn(() => unsubscribe) },
      workspace: {
        activeFile: 'C:/Synthetic/note.md', activeEditor: { openFile: vi.fn() }, on: vi.fn(() => unsubscribe), ribbon: {},
        sidebar: { addPanel: vi.fn((_panel: unknown) => remove), switch: vi.fn(), container: { addPanel: (panel: { containerEl: HTMLElement }) => document.body.append(panel.containerEl), removePanel: (panel: { containerEl: HTMLElement }) => panel.containerEl.remove() } },
      },
    }
    const invoke = vi.fn(async () => ({ files: [{ path: 'C:/Synthetic/Recent.md', date: 1 }], folders: [] }))
    vi.stubGlobal('JSBridge', { invoke })
    const plugin = new QuickAccessPlugin(app as never, { id: 'prisant-labs.favorite-folders-files', name: 'Favorites' } as never)
    plugin.onload(); await vi.advanceTimersByTimeAsync(0)
    const panel = app.workspace.sidebar.addPanel.mock.calls[0]?.[0] as { containerEl: HTMLElement; show(): void; ribbonButton: { id: string; title: string; icon: HTMLElement } }
    expect(panel.ribbonButton).toMatchObject({ id: 'prisant-labs.favorite-folders-files', title: 'Favorites' })
    expect(panel.ribbonButton.icon.querySelector('svg')?.getAttribute('width')).toBe('24')
    expect(panel.ribbonButton.icon.querySelector('svg')?.classList.contains('qa-ribbon-icon')).toBe(true)
    panel.show(); expect(document.querySelector('.qa-favorites')).not.toBeNull()
    expect(panel.containerEl.querySelector('h2')?.textContent).toBe('Favorites')
    expect(app.workspace.on).toHaveBeenCalledWith('file:open', expect.any(Function))
    const commands = (plugin as unknown as { commands: { title: string; callback(): void }[] }).commands
    expect(commands.map(command => command.title)).toEqual(['Favorites: Toggle panel', 'Favorites: Settings'])
    expect(invoke).not.toHaveBeenCalled()
    panel.containerEl.querySelector<HTMLButtonElement>('[data-key="tab-recent"]')!.click()
    await vi.advanceTimersByTimeAsync(0)
    panel.containerEl.querySelector<HTMLButtonElement>('[data-key="history-import"]')!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('setting.getRecentFiles')
    expect(panel.containerEl.textContent).toContain('Recent.md')
    expect(panel.containerEl.querySelector('[data-key="history-import"]')).toBeNull()
    const tab = (plugin as unknown as { tabs: Array<{ containerEl: HTMLElement; onshow(): void; onhide(): void }> }).tabs[0]
    document.body.append(tab.containerEl); tab.onshow()
    const recentStatus = () => tab.containerEl.querySelector('[data-recent-status]')!.textContent
    expect(recentStatus()).toContain('1 file, 0 folders'); expect(recentStatus()).not.toContain('Recent.md')
    tab.containerEl.querySelector<HTMLButtonElement>('[data-action="history-clear"]')!.click()
    expect(recentStatus()).toContain('No snapshot imported')
    expect(panel.containerEl.textContent).not.toContain('Recent.md')
    expect(panel.containerEl.querySelector('[data-key="history-import"]')).not.toBeNull()
    tab.onhide()
    commands[1].callback(); commands[1].callback()
    expect(app.commands.run).toHaveBeenCalledTimes(2)
    expect(app.commands.run).toHaveBeenLastCalledWith('settings:open', [])
    expect(document.querySelectorAll('.typ-modal__wrapper')).toHaveLength(0)
    plugin.onunload()
    expect(remove).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0); expect(document.querySelector('.quick-access')).toBeNull()
    expect(document.querySelectorAll('.typ-modal__wrapper')).toHaveLength(0)
    panel.show(); expect(document.querySelector('.quick-access')).toBeNull()
    commands[1].callback(); expect(app.commands.run).toHaveBeenCalledTimes(2)
  })
})
