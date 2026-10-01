import { afterEach, describe, expect, it, vi } from 'vitest'
import { MacRecentReader, type MacBridge, type QuickOpenPanel } from './mac-recent'
import { parseTyporaRecent } from './native-import'

afterEach(() => { vi.useRealTimers() })

/** Typora's macOS bridge and Quick Open, as its page code wires them (synthetic paths only). */
function typora(options: { files?: unknown; folders?: unknown; push?: 'sync' | 'async' | 'never'; answerFolders?: boolean } = {}) {
  const received: Array<{ self: unknown; paths: unknown }> = []
  class TyporaQuickOpenPanel { setRecentFiles(paths: unknown) { received.push({ self: this, paths }); return 'typora-result' } }
  const services = { panel: new TyporaQuickOpenPanel() as QuickOpenPanel | undefined, bridge: undefined as MacBridge | undefined }
  // registerBridge: bridge.registerHandler("quickOpen.setRecentFiles", (e, t) => { n.setRecentFiles(e), t && t() })
  const handler = (paths: unknown) => services.panel!.setRecentFiles(paths)
  const files = 'files' in options ? options.files : ['/Fixture/Recent.md']
  const folders = 'folders' in options ? options.folders : [{ name: 'Notes', path: '/Fixture/Notes', pinned: false }]
  const callHandler = vi.fn((name: string, data?: unknown) => {
    if (name === 'library.getRecentFolders' && options.answerFolders !== false) queueMicrotask(() => (data as (rows: unknown) => void)(folders))
    if (name === 'quickOpen.cacheRecentFiles') {
      if (options.push === 'sync') handler(files)
      else if (options.push !== 'never') setTimeout(() => handler(files), 0)
    }
  })
  services.bridge = { callHandler }
  const reader = new MacRecentReader({ bridge: () => services.bridge, quickOpen: () => services.panel }, { timeoutMilliseconds: 500 })
  return { reader, services, handler, received, callHandler, TyporaQuickOpenPanel }
}

const own = (panel: unknown) => Object.prototype.hasOwnProperty.call(panel, 'setRecentFiles')

describe('Typora Recent reader for macOS', () => {
  it('asks for folders and files with the calls Typora\'s own macOS code makes', async () => {
    const t = typora()
    const raw = await t.reader.read()
    expect(raw).toEqual({ files: [{ path: '/Fixture/Recent.md' }], folders: [{ name: 'Notes', path: '/Fixture/Notes', pinned: false }] })
    expect(t.callHandler).toHaveBeenCalledTimes(2)
    expect(t.callHandler).toHaveBeenCalledWith('library.getRecentFolders', expect.any(Function))
    expect(t.callHandler.mock.calls.find(call => call[0] === 'quickOpen.cacheRecentFiles')).toEqual(['quickOpen.cacheRecentFiles'])
    expect(parseTyporaRecent(raw, 'darwin')).toMatchObject({ status: 'ready', order: 'per-kind' })
  })
  it('leaves Quick Open receiving the same list, receiver and return value', async () => {
    const t = typora()
    const pushed = ['/Fixture/Recent.md']
    const read = t.reader.read()
    expect(t.handler(pushed)).toBe('typora-result')
    await read
    expect(t.received.at(-1)).toEqual({ self: t.services.panel, paths: pushed })
    expect(t.received.at(-1)!.paths).toBe(pushed)
  })
  it('captures a list that Typora sends during the request itself', async () => {
    const t = typora({ push: 'sync' })
    await expect(t.reader.read()).resolves.toMatchObject({ files: [{ path: '/Fixture/Recent.md' }] })
  })
  it('does not touch Quick Open before the first read', () => {
    const t = typora()
    expect(t.reader.available()).toBe(true)
    expect(own(t.services.panel)).toBe(false)
    expect(t.callHandler).not.toHaveBeenCalled()
  })
  it('keeps no list between reads: each read waits for a fresh one', async () => {
    const t = typora({ files: ['/Fixture/Fresh.md'] })
    await t.reader.read()
    t.handler(['/Fixture/Stale.md'])
    await expect(t.reader.read()).resolves.toMatchObject({ files: [{ path: '/Fixture/Fresh.md' }] })
  })
  it('copies the list so a later change by Typora cannot alter a finished read', async () => {
    const t = typora({ push: 'never' })
    const read = t.reader.read()
    const pushed = ['/Fixture/Recent.md']; t.handler(pushed); pushed.push('/Fixture/Later.md')
    await expect(read).resolves.toMatchObject({ files: [{ path: '/Fixture/Recent.md' }] })
  })
  it('times out when the files list never arrives', async () => {
    vi.useFakeTimers()
    const t = typora({ push: 'never' })
    const read = t.reader.read(); const result = expect(read).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(500); await result
  })
  it('times out when the folders call never answers', async () => {
    vi.useFakeTimers()
    const t = typora({ answerFolders: false })
    const read = t.reader.read(); const result = expect(read).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(500); await result
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects without detail when the bridge throws', async () => {
    const t = typora()
    t.callHandler.mockImplementation(() => { throw new Error('/private/path') })
    await expect(t.reader.read()).rejects.toThrow('bridge')
  })
  it('passes an unexpected list through, for the parser to reject without disclosure', async () => {
    const t = typora({ files: 'private' })
    const parsed = parseTyporaRecent(await t.reader.read(), 'darwin')
    expect(parsed.status).toBe('error'); expect(parsed.message).not.toContain('private')
  })
  it('still reads the list, and lets Typora\'s own error through, when Quick Open\'s method throws', async () => {
    const t = typora({ push: 'never' })
    t.TyporaQuickOpenPanel.prototype.setRecentFiles = () => { throw new Error('quick open failed') }
    const read = t.reader.read()
    expect(() => t.handler(['/Fixture/Recent.md'])).toThrow('quick open failed')
    await expect(read).resolves.toMatchObject({ files: [{ path: '/Fixture/Recent.md' }] })
  })
  it('restores Typora\'s method on dispose and cancels a pending read', async () => {
    const t = typora({ push: 'never' })
    const read = t.reader.read(); expect(own(t.services.panel)).toBe(true)
    t.reader.dispose()
    await expect(read).rejects.toThrow('disposed')
    expect(own(t.services.panel)).toBe(false)
    t.handler(['/Fixture/After.md']); expect(t.received.at(-1)!.paths).toEqual(['/Fixture/After.md'])
    expect(t.reader.available()).toBe(false)
    await expect(t.reader.read()).rejects.toThrow('disposed')
  })
  it('restores an own method that was installed before Favorites', async () => {
    const t = typora()
    const earlier = vi.fn(); t.services.panel!.setRecentFiles = earlier
    await t.reader.read()
    expect(earlier).toHaveBeenCalledOnce()
    t.reader.dispose()
    expect(t.services.panel!.setRecentFiles).toBe(earlier)
  })
  it('leaves a later wrapper in place on dispose and stops delivering through it', async () => {
    const t = typora()
    await t.reader.read()
    const ours = t.services.panel!.setRecentFiles
    const outer = function (this: unknown, paths: unknown) { return ours.call(this, paths) }
    t.services.panel!.setRecentFiles = outer
    t.reader.dispose()
    expect(t.services.panel!.setRecentFiles).toBe(outer)
    expect(t.handler(['/Fixture/After.md'])).toBe('typora-result')
    expect(t.received.at(-1)!.paths).toEqual(['/Fixture/After.md'])
  })
  it('forwards each list to Quick Open once when a later wrapper sits over an earlier one', async () => {
    const t = typora()
    await t.reader.read()
    const ours = t.services.panel!.setRecentFiles
    t.services.panel!.setRecentFiles = function (this: unknown, paths: unknown) { return ours.call(this, paths) }
    await expect(t.reader.read()).resolves.toMatchObject({ files: [{ path: '/Fixture/Recent.md' }] })
    t.handler(['/Fixture/Once.md'])
    expect(t.received.filter(row => (row.paths as string[])[0] === '/Fixture/Once.md')).toHaveLength(1)
  })
  it('follows Typora if it replaces the Quick Open panel', async () => {
    const t = typora()
    await t.reader.read()
    const first = t.services.panel!
    t.services.panel = new t.TyporaQuickOpenPanel()
    await expect(t.reader.read()).resolves.toMatchObject({ files: [{ path: '/Fixture/Recent.md' }] })
    expect(own(first)).toBe(false); expect(own(t.services.panel)).toBe(true)
    t.reader.dispose(); expect(own(t.services.panel)).toBe(false)
  })
  it('reports availability only when both macOS channels exist', async () => {
    const t = typora()
    t.services.bridge = undefined; expect(t.reader.available()).toBe(false)
    await expect(t.reader.read()).rejects.toThrow('unavailable')
    t.services.bridge = { callHandler: t.callHandler }; t.services.panel = undefined
    expect(t.reader.available()).toBe(false)
    t.services.panel = {} as QuickOpenPanel; expect(t.reader.available()).toBe(false)
    expect(t.callHandler).not.toHaveBeenCalled()
  })
})
