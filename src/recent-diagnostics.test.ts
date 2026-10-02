import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnoseRecent } from './recent-diagnostics'

afterEach(() => { vi.useRealTimers() })

const macPayload = () => ({
  files: [{ path: '/Synthetic/Recent.md' }, { path: '/Synthetic/image.png' }],
  folders: [{ name: 'Pinned', path: '/Synthetic/Pinned', pinned: true }, { name: 'Notes', path: '/Synthetic/Notes', pinned: false }],
})
const secrets = ['Synthetic', 'Pinned', 'Recent.md', 'image.png']

describe('Recent diagnostics', () => {
  it('reads twice on macOS through Favorites\' reader and reports shapes, never paths', async () => {
    const read = vi.fn(async () => macPayload())
    const report = await diagnoseRecent({ platform: 'darwin', version: '9.9.9', read, available: () => true, typora: { isMac: true, isWK: true, isNode: false } })
    expect(read).toHaveBeenCalledTimes(2)
    expect(report).toMatch(/^Favorites 9\.9\.9 Recent diagnostics\n/)
    expect(report).toContain('Platform: darwin')
    expect(report).toContain('Typora: isMac=true, isWK=true, isNode=false, isMacNode=false')
    expect(report).toContain('Read 1: answered after')
    expect(report).toContain('Read 2: answered after')
    expect(report).toContain('files: 2 item(s); keys: {path}; date types: none; path kinds: absolute path')
    expect(report).toContain('folders: 2 item(s); keys: {name path pinned}; date types: none; path kinds: absolute path; pinned at positions: 1')
    expect(report).toContain('Favorites shows: Typora\'s order; 1 Markdown file(s), 2 folder(s)')
    expect(report).toContain('RESULT: PASS')
    for (const secret of secrets) expect(report).not.toContain(secret)
  })
  it('fails when the second macOS read gets nothing, which means Recent would work only once', async () => {
    const read = vi.fn<() => Promise<unknown>>().mockResolvedValueOnce(macPayload()).mockRejectedValueOnce(new Error('timeout'))
    const report = await diagnoseRecent({ platform: 'darwin', version: '9.9.9', read, available: () => true })
    expect(report).toContain('Read 2: failed (timeout)')
    expect(report).toContain('RESULT: FAIL')
    expect(report).toContain('- Read 2 failed after read 1 worked, so Recent would work only once.')
  })
  it('reads once on Windows and reports a dated list as most recent first', async () => {
    const read = vi.fn(async () => ({
      files: [{ name: 'A.md', path: 'C:\\Synthetic\\A.md', date: 2 }],
      folders: [{ name: 'Pinned', path: 'C:\\Synthetic\\Pinned', pinned: true, date: '2026-09-01T00:00:00.000Z' }],
    }))
    const report = await diagnoseRecent({ platform: 'win32', version: '9.9.9', read })
    expect(read).toHaveBeenCalledOnce()
    expect(report).toContain('files: 1 item(s); keys: {date name path}; date types: Number; path kinds: absolute path')
    expect(report).toContain('Favorites shows: Most recent first; 1 Markdown file(s), 1 folder(s)')
    expect(report).toContain('RESULT: PASS')
    for (const secret of [...secrets, 'A.md']) expect(report).not.toContain(secret)
  })
  it('reports a read that never answers instead of waiting forever', async () => {
    vi.useFakeTimers()
    const read = vi.fn(() => new Promise<unknown>(() => {}))
    const pending = diagnoseRecent({ platform: 'win32', version: '9.9.9', read, timeoutMilliseconds: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    const report = await pending
    expect(report).toContain('Read 1: no answer after 1 s')
    expect(report).toContain('RESULT: FAIL')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('makes no read when the macOS channels are unavailable', async () => {
    const read = vi.fn(async () => macPayload())
    const report = await diagnoseRecent({ platform: 'darwin', version: '9.9.9', read, available: () => false })
    expect(read).not.toHaveBeenCalled()
    expect(report).toContain('Reader: unavailable')
    expect(report).toContain('RESULT: FAIL')
  })
  it('reports a platform without a Recent reader', async () => {
    const report = await diagnoseRecent({ platform: 'linux', version: '9.9.9' })
    expect(report).toContain('Reader: none for this platform')
    expect(report).toContain('RESULT: FAIL')
  })
  it('shows the parser\'s path-free verdict when Typora sends something unexpected', async () => {
    const read = vi.fn(async () => ({ files: [{ path: 'file:///Synthetic/A.md' }], folders: [] }))
    const report = await diagnoseRecent({ platform: 'darwin', version: '9.9.9', read, available: () => true })
    expect(report).toContain('path kinds: file URL')
    expect(report).toContain('Favorites shows: an error (Could not read Typora Recent: an unsupported response was returned.)')
    expect(report).toContain('RESULT: FAIL')
    expect(report).not.toContain('Synthetic')
  })
  it('ignores a read that fails after it has already timed out', async () => {
    vi.useFakeTimers()
    const unhandled = vi.fn(); process.on('unhandledRejection', unhandled)
    try {
      const read = vi.fn(() => new Promise<unknown>((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 2000)))
      const pending = diagnoseRecent({ platform: 'win32', version: '9.9.9', read, timeoutMilliseconds: 1000 })
      await vi.advanceTimersByTimeAsync(3000)
      expect(await pending).toContain('Read 1: no answer after 1 s')
      await vi.advanceTimersByTimeAsync(0)
      expect(unhandled).not.toHaveBeenCalled()
    } finally { process.off('unhandledRejection', unhandled) }
  })
  it('names only the kind of a failure whose message could hold a path', async () => {
    const read = vi.fn(async () => { throw new TypeError('/Synthetic/private') })
    const report = await diagnoseRecent({ platform: 'win32', version: '9.9.9', read })
    expect(report).toContain('Read 1: failed (TypeError)')
    expect(report).not.toContain('Synthetic')
  })
})
