import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowseListError, type BrowseEntry, type BrowseSource } from './browse-fs'
import { DRIVES_KEY } from './browse-model'
import { BrowseController, type BrowseSnapshot } from './browse-runtime'
import { DEFAULT_BROWSE, normalizeBrowseRecord, type BrowseRecord } from './browse-store'

afterEach(() => { vi.useRealTimers() })
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function memoryStore(initial: Partial<BrowseRecord> = {}) {
  const store = {
    record: normalizeBrowseRecord({ ...DEFAULT_BROWSE, ...initial }, 'win32'),
    fail: false,
    read: vi.fn(async () => structuredClone(store.record)),
    update: vi.fn(async (change: (record: BrowseRecord) => BrowseRecord) => {
      if (store.fail) throw new Error('synthetic write failure')
      store.record = normalizeBrowseRecord(change(structuredClone(store.record)), 'win32'); return structuredClone(store.record)
    }),
    close: vi.fn(async () => {}),
  }
  return store
}
function source(tree: Record<string, BrowseEntry[] | Error>) {
  return {
    list: vi.fn(async (folder: string) => { const entries = tree[folder]; if (entries instanceof Error) throw entries; if (!entries) throw new BrowseListError('missing'); return entries }),
    drives: vi.fn(async () => ['C:/', 'D:/']),
    home: () => 'C:/Users/Synthetic',
  } satisfies BrowseSource
}
const folder = (path: string): BrowseEntry => ({ kind: 'folder', name: path.slice(path.lastIndexOf('/') + 1), path })
const file = (path: string): BrowseEntry => ({ kind: 'file', name: path.slice(path.lastIndexOf('/') + 1), path })
async function started(store: ReturnType<typeof memoryStore>, files: BrowseSource | undefined, options: ConstructorParameters<typeof BrowseController>[3] = {}) {
  const controller = new BrowseController(store, files, 'win32', { pollMilliseconds: 0, ...options })
  const seen: BrowseSnapshot[] = []
  controller.subscribe(snapshot => seen.push(snapshot))
  await controller.start(); await flush()
  return { controller, seen }
}

describe('Browse controller', () => {
  it('reads the record and lists the expanded folders, nested ones included', async () => {
    const store = memoryStore({ roots: ['C:/Synthetic'], expanded: ['folder:c:/synthetic', 'folder:c:/synthetic/atlas'] })
    const files = source({ 'C:/Synthetic': [folder('C:/Synthetic/Atlas'), file('C:/Synthetic/Brief.md')], 'C:/Synthetic/Atlas': [file('C:/Synthetic/Atlas/Plan.md')] })
    const { controller } = await started(store, files)
    expect(files.list.mock.calls.map(([path]) => path)).toEqual(['C:/Synthetic', 'C:/Synthetic/Atlas'])
    expect(controller.snapshot).toMatchObject({ available: true, writable: true, home: 'C:/Users/Synthetic', record: { roots: ['C:/Synthetic'] } })
    expect(controller.snapshot.folders['folder:c:/synthetic/atlas']).toEqual({ status: 'ready', entries: [file('C:/Synthetic/Atlas/Plan.md')] })
    controller.dispose()
    expect(store.close).toHaveBeenCalled()
  })

  it('does not list while the panel is hidden, and lists when it is shown', async () => {
    let visible = false
    const store = memoryStore({ roots: ['C:/Synthetic'], expanded: ['folder:c:/synthetic'] })
    const files = source({ 'C:/Synthetic': [] })
    const { controller } = await started(store, files, { isVisible: () => visible })
    expect(files.list).not.toHaveBeenCalled()
    visible = true; controller.refresh(true); await flush()
    expect(files.list).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('expands and collapses, saving the expanded folders and keeping the listing for next time', async () => {
    const store = memoryStore({ roots: ['C:/Synthetic'] })
    const files = source({ 'C:/Synthetic': [file('C:/Synthetic/Brief.md')] })
    const { controller } = await started(store, files)
    await controller.toggle('folder:c:/synthetic', 'C:/Synthetic'); await flush()
    expect(store.record.expanded).toEqual(['folder:c:/synthetic'])
    expect(controller.snapshot.folders['folder:c:/synthetic'].status).toBe('ready')
    await controller.toggle('folder:c:/synthetic', 'C:/Synthetic'); await flush()
    expect(store.record.expanded).toEqual([])
    // Expanding again shows the kept entries at once and reads the folder again behind them.
    files.list.mockImplementationOnce(() => new Promise(() => {}))
    void controller.toggle('folder:c:/synthetic', 'C:/Synthetic'); await flush()
    expect(controller.snapshot.folders['folder:c:/synthetic']).toEqual({ status: 'loading', entries: [file('C:/Synthetic/Brief.md')] })
    expect(files.list).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('lists drives under the drives key and shows listing errors by name only', async () => {
    const store = memoryStore({ roots: ['C:/Private'], expanded: [DRIVES_KEY, 'folder:c:/private'] })
    const files = source({ 'C:/Private': new BrowseListError('denied') })
    const { controller } = await started(store, files)
    expect(controller.snapshot.folders[DRIVES_KEY]).toEqual({ status: 'ready', entries: [{ kind: 'folder', name: 'C:', path: 'C:/' }, { kind: 'folder', name: 'D:', path: 'D:/' }] })
    expect(controller.snapshot.folders['folder:c:/private']).toEqual({ status: 'error', entries: [], error: 'No access' })
    controller.dispose()
  })

  it('ignores a listing that finishes after a newer one or after disposal', async () => {
    const store = memoryStore({ roots: ['C:/Synthetic'], expanded: ['folder:c:/synthetic'] })
    const files = source({})
    const resolvers: Array<(entries: BrowseEntry[]) => void> = []
    files.list.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
    const { controller } = await started(store, files)
    controller.refresh(true); await flush()
    expect(resolvers).toHaveLength(2)
    resolvers[1]([file('C:/Synthetic/New.md')]); await flush()
    resolvers[0]([file('C:/Synthetic/Old.md')]); await flush()
    expect(controller.snapshot.folders['folder:c:/synthetic'].entries).toEqual([file('C:/Synthetic/New.md')])
    controller.refresh(true); await flush()
    controller.dispose(); resolvers[2]([]); await flush()
    expect(controller.snapshot.folders['folder:c:/synthetic'].entries).toEqual([file('C:/Synthetic/New.md')])
  })

  it('refreshes at most once per interval unless forced', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const store = memoryStore({ roots: ['C:/Synthetic'], expanded: ['folder:c:/synthetic'] })
    const files = source({ 'C:/Synthetic': [] })
    const { controller } = await started(store, files, { refreshMinIntervalMilliseconds: 5000 })
    controller.refresh(); controller.refresh(); await flush()
    expect(files.list).toHaveBeenCalledTimes(2)
    vi.setSystemTime(1_006_000); controller.refresh(); await flush()
    expect(files.list).toHaveBeenCalledTimes(3)
    controller.refresh(true); await flush()
    expect(files.list).toHaveBeenCalledTimes(4)
    controller.dispose()
  })

  it('selects the tab and collapses the section in its own record', async () => {
    const store = memoryStore()
    const { controller } = await started(store, source({}))
    await controller.setActive(true); await controller.setCollapsed(true)
    expect(store.record).toMatchObject({ active: true, collapsed: true })
    controller.dispose()
  })

  it('saves the tab order in Browse\'s own record', async () => {
    const store = memoryStore()
    const { controller } = await started(store, source({}))
    await controller.setOrder(['browse', 'favorites', 'recent'])
    expect(store.record.order).toEqual(['browse', 'favorites', 'recent'])
    expect(controller.snapshot.record.order).toEqual(['browse', 'favorites', 'recent'])
    controller.dispose()
  })

  it('adds, removes and replaces roots without repeating a folder', async () => {
    const store = memoryStore({ roots: ['C:/Synthetic'] })
    const { controller } = await started(store, source({}))
    await controller.addRoot('c:\\synthetic\\'); expect(store.record.roots).toEqual(['C:/Synthetic'])
    await controller.addRoot('D:\\Archive'); expect(store.record.roots).toEqual(['C:/Synthetic', 'D:/Archive'])
    await controller.removeRoot('c:/SYNTHETIC'); expect(store.record.roots).toEqual(['D:/Archive'])
    await controller.saveRoots({ roots: ['E:/Notes', 'D:/Archive'], home: false, drives: false })
    expect(store.record).toMatchObject({ roots: ['E:/Notes', 'D:/Archive'], home: false, drives: false })
    await expect(controller.addRoot('relative')).rejects.toThrow('absolute')
    controller.dispose()
  })

  it('reports a failed save and goes back to what is stored', async () => {
    const store = memoryStore({ roots: ['C:/Synthetic'] })
    const { controller } = await started(store, source({ 'C:/Synthetic': [] }))
    store.fail = true
    await expect(controller.toggle('folder:c:/synthetic', 'C:/Synthetic')).rejects.toThrow('Browse settings could not be saved.')
    await flush()
    expect(controller.snapshot.record.expanded).toEqual([])
    controller.dispose()
  })

  it('picks up another window\'s change on the poll and publishes only when something changed', async () => {
    vi.useFakeTimers()
    const store = memoryStore()
    const controller = new BrowseController(store, source({}), 'win32', { pollMilliseconds: 2000 })
    const seen: BrowseSnapshot[] = []; controller.subscribe(snapshot => seen.push(snapshot))
    await controller.start(); await flush()
    const count = seen.length
    await vi.advanceTimersByTimeAsync(4000)
    expect(seen).toHaveLength(count)
    store.record = { ...store.record, roots: ['C:/Other window'] }
    await vi.advanceTimersByTimeAsync(2000)
    expect(seen).toHaveLength(count + 1); expect(seen.at(-1)!.record.roots).toEqual(['C:/Other window'])
    controller.dispose()
  })

  it('needs no structuredClone, which older macOS WebKit lacks', async () => {
    vi.stubGlobal('structuredClone', undefined)
    try {
      const store = memoryStore({ roots: ['C:/Synthetic'] })
      store.read.mockImplementation(async () => ({ ...store.record, roots: [...store.record.roots], expanded: [...store.record.expanded], order: [...store.record.order] }))
      const controller = new BrowseController({ ...store, update: async change => (store.record = normalizeBrowseRecord(change({ ...store.record }), 'win32')) }, source({ 'C:/Synthetic': [] }), 'win32', { pollMilliseconds: 0 })
      await controller.start(); await controller.toggle('folder:c:/synthetic', 'C:/Synthetic'); await flush()
      expect(controller.snapshot.record.expanded).toEqual(['folder:c:/synthetic'])
      controller.dispose()
    } finally { vi.unstubAllGlobals() }
  })

  it('works without a file source and says so', async () => {
    const store = memoryStore({ roots: ['C:/Synthetic'], expanded: ['folder:c:/synthetic'] })
    const { controller } = await started(store, undefined)
    expect(controller.snapshot).toMatchObject({ available: false, folders: {} })
    await controller.toggle('folder:c:/synthetic', 'C:/Synthetic')
    expect(store.update).not.toHaveBeenCalled()
    controller.dispose()
  })
})
