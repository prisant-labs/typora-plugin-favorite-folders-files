// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowseController } from './browse-runtime'
import { cloneBrowseRecord, normalizeBrowseRecord } from './browse-store'
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

  it('saves the tab order through Browse, shows a failed save and keeps keyboard focus on the moved tab', async () => {
    const state = createFavoritesState()
    const controller = new FavoritesController({ read: async () => state, update: async () => state, commitDraft: async () => state, close: async () => {} }, 'win32')
    await controller.start()
    let record = normalizeBrowseRecord({ order: ['favorites', 'browse', 'recent'] }, 'win32'), fail = false
    const browse = new BrowseController({
      read: async () => cloneBrowseRecord(record),
      update: async change => { if (fail) throw new Error('synthetic write failure'); return record = normalizeBrowseRecord(change(cloneBrowseRecord(record)), 'win32') },
      close: async () => {},
    }, undefined, 'win32', { pollMilliseconds: 0 })
    await browse.start()
    const tab = new QuickAccessSettingTab(controller, { tabs: {
      state: () => ({ order: browse.snapshot.record.order, writable: browse.snapshot.writable }),
      subscribe: listener => browse.subscribe(() => listener()), setOrder: order => browse.setOrder(order),
    } })
    document.body.append(tab.containerEl); tab.onshow()
    const names = () => [...tab.containerEl.querySelectorAll('[data-tab-order] .qa-settings__order-name')].map(node => node.textContent)
    const move = (label: string) => tab.containerEl.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
    expect(names()).toEqual(['Favorites', 'Browse', 'Recent'])
    move('Move up: Browse').focus(); move('Move up: Browse').click()
    await vi.waitFor(() => expect(record.order).toEqual(['browse', 'favorites', 'recent']))
    expect(names()).toEqual(['Browse', 'Favorites', 'Recent'])
    // Browse is now first, so its Move up is disabled and focus moves to its Move down.
    expect(document.activeElement).toBe(move('Move down: Browse'))
    expect(tab.containerEl.querySelector('.qa-settings__preview [role=tab]')?.textContent).toBe('Browse')
    fail = true; move('Move down: Browse').click()
    await vi.waitFor(() => expect(tab.containerEl.textContent).toContain('Browse settings could not be saved.'))
    expect(names()).toEqual(['Browse', 'Favorites', 'Recent'])
    tab.dispose(); browse.dispose(); controller.dispose()
  })

  it('edits Browse roots through Browse, and keeps a typed path and its message across redraws', async () => {
    const state = createFavoritesState()
    const controller = new FavoritesController({ read: async () => state, update: async operation => applyFavoritesOperation(state, operation, 'win32'), commitDraft: async () => state, close: async () => {} }, 'win32')
    await controller.start()
    let record = normalizeBrowseRecord({ roots: ['C:/Projects'] }, 'win32'), fail = false
    const browse = new BrowseController({
      read: async () => cloneBrowseRecord(record),
      update: async change => { if (fail) throw new Error('synthetic write failure'); return record = normalizeBrowseRecord(change(cloneBrowseRecord(record)), 'win32') },
      close: async () => {},
    }, undefined, 'win32', { pollMilliseconds: 0 })
    await browse.start()
    const tab = new QuickAccessSettingTab(controller, { browse: {
      platform: 'win32', state: () => browse.roots, subscribe: listener => browse.subscribe(() => listener()),
      save: change => browse.saveRoots(change), current: () => 'C:/Notes',
    } })
    document.body.append(tab.containerEl); tab.onshow()
    const section = () => tab.containerEl.querySelector<HTMLElement>('[data-settings-section="browse"]')!
    const field = () => section().querySelector<HTMLInputElement>('input[aria-label="Folder path"]')!
    const type = (value: string) => { field().value = value; field().dispatchEvent(new Event('input', { bubbles: true })) }
    const add = () => section().querySelector<HTMLButtonElement>('button[aria-label="Add folder"]')!.click()
    const error = () => section().querySelector('[data-browse-setting="add"] .qa-settings__error')?.textContent
    type('D:\\Archive'); add()
    await vi.waitFor(() => expect(record.roots).toEqual(['C:/Projects', 'D:/Archive']))
    await vi.waitFor(() => expect([...section().querySelectorAll('.qa-settings__root-name')].map(node => node.textContent)).toEqual(['Projects', 'Archive', 'Home', 'Drives']))
    fail = true; type('D:\\Other'); add()
    await vi.waitFor(() => expect(error()).toBe('Browse settings could not be saved.'))
    expect(field().value).toBe('D:\\Other')
    // A redraw for another setting keeps both.
    fail = false; await controller.change({ type: 'favorites:preferences', patch: { layout: 'stacked' } })
    expect(tab.containerEl.querySelector<HTMLSelectElement>('[aria-label="Layout"]')!.value).toBe('stacked')
    expect(error()).toBe('Browse settings could not be saved.'); expect(field().value).toBe('D:\\Other')
    // The next change clears the message.
    add()
    await vi.waitFor(() => expect(record.roots).toEqual(['C:/Projects', 'D:/Archive', 'D:/Other']))
    await vi.waitFor(() => expect(error()).toBeUndefined())
    expect(field().value).toBe('')
    tab.dispose(); browse.dispose(); controller.dispose()
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
    expect(tab.containerEl.textContent).toContain('Recently opened ordering is available')
    expect(controller.state.revision).toBe(0)
    tab.onhide()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    notify(); expect(tab.containerEl.childElementCount).toBe(0)
    controller.dispose()
  })
})
