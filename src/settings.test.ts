// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoritesController } from './controller'
import { applyFavoritesOperation, createFavoritesState, type FavoritesOperation } from './model'
import { replayFavoritesDraft, type FavoritesDraft } from './editor-state'
import { openSettings, QuickAccessSettingTab } from './settings'
vi.mock('@typora-community-plugin/core', () => import('../test/support/typora-core'))
afterEach(() => { document.body.replaceChildren() })
describe('native shared settings', () => {
  it('uses the public Core Settings command without creating a separate modal', () => {
    const app = { commands: { run: vi.fn() } }
    openSettings(app)
    expect(app.commands.run).toHaveBeenCalledWith('settings:open', [])
    expect(document.querySelector('.typ-modal__wrapper')).toBeNull()
  })

  it('edits the same preference state as the panel and detaches on hide/unload', async () => {
    let state = createFavoritesState()
    const store = {
      read: async () => state,
      update: async (operation: FavoritesOperation) => state = applyFavoritesOperation(state, operation, 'darwin'),
      commitDraft: async (draft: FavoritesDraft) => state = replayFavoritesDraft(state, draft, 'darwin'),
      close: async () => {},
    }
    const controller = new FavoritesController(store, 'darwin')
    await controller.start()
    const tab = new QuickAccessSettingTab(controller)
    expect(tab.name).toBe('Favorites')
    document.body.append(tab.containerEl)
    tab.onshow()
    const layout = tab.containerEl.querySelector<HTMLSelectElement>('[aria-label="Layout"]')!
    layout.focus()
    layout.value = 'stacked'; layout.dispatchEvent(new Event('change'))
    // Native browsers can blur a select as soon as it becomes disabled.
    layout.blur()
    await controller.idle()
    expect(controller.state.preferences.layout).toBe('stacked')
    expect(document.activeElement).toBe(tab.containerEl.querySelector('[aria-label="Layout"]'))
    await controller.change({ type: 'favorites:preferences', patch: { groupView: 'filter' } })
    expect(tab.containerEl.querySelector<HTMLSelectElement>('[aria-label="Group view"]')!.value).toBe('filter')
    expect(document.activeElement).toBe(tab.containerEl.querySelector('[aria-label="Layout"]'))
    const outside = document.createElement('button'); document.body.append(outside); outside.focus()
    await controller.change({ type: 'favorites:preferences', patch: { itemSort: 'custom' } })
    expect(document.activeElement).toBe(outside)
    tab.onhide()
    await controller.change({ type: 'favorites:preferences', patch: { layout: 'tabs' } })
    expect(tab.containerEl.childElementCount).toBe(0)
    tab.dispose(); controller.dispose()
  })

  it('preserves focus and the confirmed value after a failed keyboard setting save', async () => {
    const state = createFavoritesState()
    const controller = new FavoritesController({
      read: async () => state,
      update: async () => { throw new Error('Setting save failed') },
      commitDraft: async () => state,
      close: async () => {},
    }, 'darwin')
    await controller.start()
    const tab = new QuickAccessSettingTab(controller)
    document.body.append(tab.containerEl); tab.onshow()
    const layout = tab.containerEl.querySelector<HTMLSelectElement>('[aria-label="Layout"]')!
    layout.focus(); layout.value = 'stacked'; layout.dispatchEvent(new Event('change')); layout.blur()
    await controller.idle(); await Promise.resolve()
    expect(document.activeElement).toBe(layout)
    expect(layout.disabled).toBe(false)
    expect(layout.value).toBe('tabs')
    expect(tab.containerEl.textContent).toContain('Setting save failed')
    tab.dispose(); controller.dispose()
  })

  it('follows the Recent snapshot and returns keyboard focus to its action after the rebuild', async () => {
    const state = createFavoritesState()
    const controller = new FavoritesController({ read: async () => state, update: async () => state, commitDraft: async () => state, close: async () => {} }, 'win32')
    await controller.start()
    let recent = { available: true, loading: false, files: 0, folders: 0, ordered: false } as { available: boolean; loading: boolean; importedAt?: number; files: number; folders: number; ordered: boolean }
    let notify = () => {}
    const importHistory = vi.fn(() => { recent = { ...recent, loading: true }; notify() })
    const tab = new QuickAccessSettingTab(controller, { recentStatus: () => recent, importHistory, subscribeRecent: listener => { notify = listener; return () => {} } })
    document.body.append(tab.containerEl); tab.onshow()
    expect(tab.containerEl.querySelector('.qa-settings-host > .qa-settings')).not.toBeNull()
    const action = () => tab.containerEl.querySelector<HTMLButtonElement>('[data-action="history-import"]')!
    action().focus(); action().click()
    await vi.waitFor(() => expect(importHistory).toHaveBeenCalledOnce())
    expect(action().textContent).toBe('Importing…'); expect(action().disabled).toBe(true)
    recent = { ...recent, loading: false, importedAt: 1000, files: 1, folders: 1, ordered: true }; notify()
    expect(action().textContent).toBe('Refresh snapshot')
    expect(document.activeElement).toBe(action())
    tab.dispose(); controller.dispose()
  })

  it('refreshes Recent capability without a preference write and releases the subscription on hide', async () => {
    const state = createFavoritesState()
    const controller = new FavoritesController({ read: async () => state, update: async () => state, commitDraft: async () => state, close: async () => {} }, 'win32')
    await controller.start()
    let available = false
    let notify = () => {}
    const unsubscribe = vi.fn()
    const tab = new QuickAccessSettingTab(controller, {
      version: '0.1.0', author: 'Example Author', repo: 'example/favorites',
      recentAvailable: () => available,
      subscribeRecent: listener => { notify = listener; return unsubscribe },
    })
    document.body.append(tab.containerEl); tab.onshow()
    const option = () => tab.containerEl.querySelector<HTMLOptionElement>('[aria-label="Group order"] option[value="recent"]')!
    expect(option().disabled).toBe(true)
    available = true; notify()
    expect(option().disabled).toBe(false)
    expect(tab.containerEl.textContent).toContain('Imported snapshot ordering is available')
    expect(controller.state.revision).toBe(0)
    tab.onhide()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    notify(); expect(tab.containerEl.childElementCount).toBe(0)
    controller.dispose()
  })
})
