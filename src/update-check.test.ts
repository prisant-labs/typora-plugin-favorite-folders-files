import { describe, expect, it, vi } from 'vitest'
import { compareVersions, UpdateNotifier, type MarketplaceLike, type PluginManagerLike, type UpdateRecord } from './update-check'

const ID = 'prisant-labs.favorite-folders-files'
const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 2, 12)

function memoryStore(initial: UpdateRecord = { checkForUpdates: true }) {
  let record = structuredClone(initial)
  return {
    read: vi.fn(async () => structuredClone(record)),
    update: vi.fn(async (change: (current: UpdateRecord) => UpdateRecord) => { record = structuredClone(change(structuredClone(record))); return structuredClone(record) }),
    get record() { return record },
  }
}

/**
 * A stand-in for Core's in-memory Marketplace: empty until loaded, like Core's per-window list.
 * Loading sets `newestVersion` from the statistics file, as Core's markUpdatesAvailable does.
 */
function marketplace(options: { listed?: boolean; newest?: unknown; loaded?: boolean; stats?: boolean; preloaded?: string } = {}) {
  const listed = options.listed ?? true
  const info: { id: string; newestVersion?: string } = { id: ID }
  if (options.preloaded) info.newestVersion = options.preloaded
  const market = {
    pluginList: (options.preloaded ? [info] : []) as unknown[],
    pluginStats: {} as Record<string, unknown>,
    get isLoaded() { return market.pluginList.length > 0 },
    getPlugin: vi.fn((id: string) => market.pluginList.find(entry => (entry as { id: string }).id === id) as typeof info | undefined),
    loadCommunityPlugins: vi.fn(async () => {
      if (options.loaded === false) return
      market.pluginList = listed ? [info, { id: 'someone.else' }] : [{ id: 'someone.else' }]
      market.pluginStats = options.stats === false ? {} : { 'someone.else': { downloads: 1 }, ...(typeof options.newest === 'string' ? { [ID]: { [options.newest]: 1 } } : {}) }
      if (typeof options.newest === 'string') info.newestVersion = options.newest
      else delete info.newestVersion
    }),
    // Core falls back to GitHub's REST API here; the automatic check must never call it.
    getPluginNewestVersion: vi.fn(async (_info: unknown) => options.newest),
  }
  return market
}

function notifier(market?: MarketplaceLike, store = memoryStore(), manager?: Partial<PluginManagerLike>, now = () => NOW) {
  const plugins: PluginManagerLike | undefined = market || manager ? { marketplace: market, updatePlugin: vi.fn(async () => {}), ...manager } as PluginManagerLike : undefined
  const instance = new UpdateNotifier({ id: ID, installed: '0.1.3', plugins: () => plugins, store, now })
  return { instance, store, plugins }
}

describe('compareVersions', () => {
  it('compares plain major.minor.patch versions numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('0.1.3', '0.1.3')).toBe(0)
    expect(compareVersions('0.1.3', '1.0.0')).toBe(-1)
  })

  it('refuses anything that is not a plain version', () => {
    for (const value of ['v0.1.4', '0.1.4-beta.1', '0.1', '', ' 0.1.4', '0.1.4.1', 5, undefined, null]) {
      expect(compareVersions(value as string, '0.1.3')).toBeUndefined()
      expect(compareVersions('0.1.3', value as string)).toBeUndefined()
    }
  })
})

describe('UpdateNotifier', () => {
  it('reuses Core\'s loaded Marketplace data without asking Core to check', async () => {
    const market = marketplace({ preloaded: '0.1.5' })
    const { instance } = notifier(market, memoryStore({ checkForUpdates: false }))
    const listener = vi.fn(); instance.subscribe(listener)
    await instance.check()
    expect(instance.state).toEqual({ version: '0.1.5', enabled: false })
    expect(listener).toHaveBeenCalled()
    expect(market.loadCommunityPlugins).not.toHaveBeenCalled()
    expect(market.getPluginNewestVersion).not.toHaveBeenCalled()
  })

  it('asks Core to load its lists once, reads the version from them, and stores the result', async () => {
    const market = marketplace({ newest: '0.1.5' })
    const { instance, store } = notifier(market)
    await instance.check()
    expect(market.loadCommunityPlugins).toHaveBeenCalledOnce()
    // Core's getPluginNewestVersion can fall back to GitHub's REST API; the check reads the loaded lists instead.
    expect(market.getPluginNewestVersion).not.toHaveBeenCalled()
    expect(instance.state).toEqual({ version: '0.1.5', enabled: true })
    expect(store.record).toEqual({ checkForUpdates: true, checked: { at: NOW, version: '0.1.5' } })
  })

  it('reuses a check from any window for 24 hours, then checks again', async () => {
    const market = marketplace({ newest: '0.1.6' })
    const store = memoryStore({ checkForUpdates: true, checked: { at: NOW - 23 * HOUR, version: '0.1.5' } })
    let now = NOW
    const { instance } = notifier(market, store, undefined, () => now)
    await instance.check()
    expect(market.loadCommunityPlugins).not.toHaveBeenCalled()
    expect(instance.state.version).toBe('0.1.5')
    now = NOW + 2 * HOUR
    await instance.check()
    expect(market.loadCommunityPlugins).toHaveBeenCalledOnce()
    expect(instance.state.version).toBe('0.1.6')
    expect(store.record.checked).toEqual({ at: now, version: '0.1.6' })
  })

  it('treats a stored check from the future as due', async () => {
    const market = marketplace({ newest: '0.1.5' })
    const { instance } = notifier(market, memoryStore({ checkForUpdates: true, checked: { at: NOW + HOUR, version: '0.1.4' } }))
    await instance.check()
    expect(market.loadCommunityPlugins).toHaveBeenCalledOnce()
    expect(instance.state.version).toBe('0.1.5')
  })

  it('shows nothing for an equal, older or malformed version', async () => {
    for (const newest of ['0.1.3', '0.1.2', 'v0.1.5', '0.1.5-beta.1']) {
      const { instance } = notifier(marketplace({ newest }))
      await instance.check()
      expect(instance.state.version, newest).toBeUndefined()
    }
    const { instance } = notifier(marketplace({ preloaded: 'v0.2.0' }), memoryStore({ checkForUpdates: false }))
    await instance.check()
    expect(instance.state.version).toBeUndefined()
  })

  it('never asks Core to check while the setting is off', async () => {
    const market = marketplace({ newest: '0.1.5' })
    const { instance } = notifier(market, memoryStore({ checkForUpdates: false }))
    await instance.check(); await instance.check()
    expect(market.loadCommunityPlugins).not.toHaveBeenCalled()
    expect(market.getPluginNewestVersion).not.toHaveBeenCalled()
    expect(instance.state).toEqual({ version: undefined, enabled: false })
  })

  it('stores the setting, and checks when it is turned back on', async () => {
    const market = marketplace({ newest: '0.1.5' })
    const { instance, store } = notifier(market)
    const listener = vi.fn(); instance.subscribe(listener)
    await instance.setEnabled(false)
    expect(store.record).toEqual({ checkForUpdates: false })
    expect(instance.state.enabled).toBe(false)
    expect(listener).toHaveBeenCalled()
    await instance.check()
    expect(market.loadCommunityPlugins).not.toHaveBeenCalled()
    await instance.setEnabled(true); await vi.waitFor(() => expect(market.loadCommunityPlugins).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(instance.state.version).toBe('0.1.5'))
  })

  it('reports a failed save of the setting to the caller', async () => {
    const store = memoryStore(); store.update.mockRejectedValueOnce(new Error('Synthetic storage failure'))
    const { instance } = notifier(marketplace(), store)
    await expect(instance.setEnabled(false)).rejects.toThrow('Synthetic storage failure')
    expect(instance.state.enabled).toBe(true)
  })

  it('saves nothing once disposed', async () => {
    const { instance, store } = notifier(marketplace())
    instance.dispose()
    await instance.setEnabled(false)
    expect(store.update).not.toHaveBeenCalled()
  })

  it('records a check that finds Favorites unlisted, or listed without statistics, and does not retry it for a day', async () => {
    for (const options of [{ listed: false }, { listed: true }]) {
      const market = marketplace(options)
      const { instance, store } = notifier(market)
      await instance.check(); await instance.check()
      expect(market.loadCommunityPlugins).toHaveBeenCalledOnce()
      expect(store.record.checked).toEqual({ at: NOW })
      expect(instance.state.version).toBeUndefined()
    }
  })

  it('fails silently, keeps no result, and retries no sooner than an hour later', async () => {
    const failures: Array<[string, () => { market?: MarketplaceLike; manager?: Partial<PluginManagerLike> }]> = [
      ['no plugin manager', () => ({})],
      ['no marketplace', () => ({ manager: { updatePlugin: vi.fn() } })],
      ['list not loaded', () => ({ market: marketplace({ loaded: false }) })],
      ['statistics not loaded', () => ({ market: marketplace({ newest: '0.1.5', stats: false }) })],
      ['load rejects', () => { const market = marketplace(); market.loadCommunityPlugins.mockRejectedValue(new Error('offline')); return { market } }],
      ['getPlugin throws', () => { const market = marketplace(); market.getPlugin.mockImplementation(() => { throw new Error('changed API') }); return { market } }],
    ]
    for (const [name, setup] of failures) {
      const { market, manager } = setup()
      let now = NOW
      const store = memoryStore()
      const { instance } = notifier(market, store, manager, () => now)
      const unhandled = vi.fn(); process.on('unhandledRejection', unhandled)
      await expect(instance.check(), name).resolves.toBeUndefined()
      expect(store.record.checked, name).toBeUndefined()
      const loads = () => (market as ReturnType<typeof marketplace> | undefined)?.loadCommunityPlugins.mock.calls.length ?? 0
      const before = loads()
      now = NOW + 59 * 60 * 1000; await instance.check()
      expect(loads(), name).toBe(before)
      now = NOW + 61 * 60 * 1000; await instance.check()
      if (market) expect(loads(), name).toBe(before + 1)
      await new Promise(resolve => setTimeout(resolve, 0))
      process.off('unhandledRejection', unhandled)
      expect(unhandled, name).not.toHaveBeenCalled()
    }
  })

  it('keeps its own completed check when the store cannot save it', async () => {
    const market = marketplace({ newest: '0.1.5' })
    const store = memoryStore(); store.update.mockRejectedValue(new Error('quota'))
    const { instance } = notifier(market, store)
    await instance.check(); await instance.check(); await instance.check()
    expect(market.loadCommunityPlugins).toHaveBeenCalledOnce()
    expect(instance.state.version).toBe('0.1.5')
  })

  it('runs one check at a time', async () => {
    const market = marketplace({ newest: '0.1.5' })
    const { instance } = notifier(market)
    await Promise.all([instance.check(), instance.check(), instance.check()])
    expect(market.loadCommunityPlugins).toHaveBeenCalledOnce()
  })

  it('changes nothing after dispose, even when a check finishes later', async () => {
    const market = marketplace({ newest: '0.1.5' })
    let release!: () => void
    market.loadCommunityPlugins.mockImplementation(() => new Promise<void>(resolve => { release = () => { market.pluginList = [{ id: ID, newestVersion: '0.1.5' }]; resolve() } }))
    const { instance, store } = notifier(market)
    const listener = vi.fn(); instance.subscribe(listener)
    const pending = instance.check()
    await vi.waitFor(() => expect(market.loadCommunityPlugins).toHaveBeenCalled())
    instance.dispose(); release(); await pending
    expect(listener).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
    expect(instance.state.version).toBeUndefined()
  })

  describe('update', () => {
    /** Core 2.10.21's updatePlugin: it re-reads the newest version and returns early when that is not newer. */
    function coreUpdate(market: ReturnType<typeof marketplace> & { installed: string }, installed = '0.1.3') {
      return vi.fn(async (id: string) => {
        const info = market.getPlugin(id)
        if (!info) return
        const version = info.newestVersion
        if (!version || compareVersions(installed, version) !== -1) return
        market.installed = version
      })
    }

    it('reloads Core\'s lists first when they predate the version the pill names', async () => {
      // This window loaded Core's lists before 0.1.5 existed; another window's check found 0.1.5.
      const market = Object.assign(marketplace({ newest: '0.1.5', preloaded: '0.1.3' }), { installed: '' })
      const updatePlugin = coreUpdate(market)
      const { instance } = notifier(market, memoryStore({ checkForUpdates: true, checked: { at: NOW - HOUR, version: '0.1.5' } }), { updatePlugin })
      await instance.check()
      expect(instance.state.version).toBe('0.1.5')
      expect(market.loadCommunityPlugins).not.toHaveBeenCalled()
      await instance.update()
      expect(market.loadCommunityPlugins).toHaveBeenCalledOnce()
      expect(market.loadCommunityPlugins.mock.invocationCallOrder[0]).toBeLessThan(updatePlugin.mock.invocationCallOrder[0])
      expect(updatePlugin).toHaveBeenCalledExactlyOnceWith(ID)
      expect(market.installed).toBe('0.1.5')
    })

    it('keeps Core\'s lists when they already name the pill\'s version, so a flaky reload cannot wipe them', async () => {
      // Core turns a failed statistics download into {} and deletes every newestVersion, so a needless reload can hurt.
      const market = Object.assign(marketplace({ preloaded: '0.1.5' }), { installed: '' })
      const updatePlugin = coreUpdate(market)
      const { instance } = notifier(market, memoryStore({ checkForUpdates: false }), { updatePlugin })
      await instance.check()
      await instance.update()
      expect(market.loadCommunityPlugins).not.toHaveBeenCalled()
      expect(market.installed).toBe('0.1.5')
    })

    it('calls Core\'s update once, even when clicked twice', async () => {
      const market = marketplace({ newest: '0.1.5' })
      const { instance, plugins } = notifier(market)
      await Promise.all([instance.update(), instance.update()])
      expect(plugins!.updatePlugin).toHaveBeenCalledExactlyOnceWith(ID)
    })

    it('rejects without calling Core when Favorites is not listed or Core cannot update', async () => {
      const unlisted = notifier(marketplace({ listed: false }))
      await expect(unlisted.instance.update()).rejects.toThrow()
      expect(unlisted.plugins!.updatePlugin).not.toHaveBeenCalled()
      const noUpdate = notifier(marketplace({ newest: '0.1.5' }), memoryStore(), { updatePlugin: undefined as never })
      await expect(noUpdate.instance.update()).rejects.toThrow()
      const none = notifier()
      await expect(none.instance.update()).rejects.toThrow()
    })

    it('passes Core\'s failure to the caller', async () => {
      const { instance } = notifier(marketplace({ newest: '0.1.5' }), memoryStore(), { updatePlugin: vi.fn(async () => { throw new Error('download failed') }) })
      await expect(instance.update()).rejects.toThrow('download failed')
    })
  })
})
