// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The probe is pasted into Typora's DevTools, so it is tested as the exact text a tester copies.
const source = readFileSync(join(process.cwd(), 'test', 'native', 'probes', 'recent.js'), 'utf8')
const METHODS = ['setRecentFiles', 'initFileCache', 'updateCache']

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); delete (globalThis as Record<string, unknown>).favoritesRecentProbe })

/** Typora's macOS globals as its page code wires them, with synthetic paths only. */
function mac(options: { resend?: boolean; via?: 'setRecentFiles' | 'initFileCache'; folders?: 'answer' | 'never'; files?: unknown } = {}) {
  let requests = 0
  class QuickOpenPanel {
    setRecentFiles(_paths: unknown) { return 'typora' }
    initFileCache(..._args: unknown[]) { return 'typora' }
    updateCache(..._args: unknown[]) { return 'typora' }
  }
  const panel = new QuickOpenPanel() as QuickOpenPanel & Record<string, unknown>
  const files = options.files ?? ['/Synthetic/Recent.md', '/Synthetic/Notes.md']
  const callHandler = vi.fn((name: string, callback?: (rows: unknown) => void) => {
    if (name === 'library.getRecentFolders' && options.folders !== 'never') {
      setTimeout(() => callback!([{ name: 'Pinned', path: '/Synthetic/Pinned', pinned: true }, { name: 'Notes', path: '/Synthetic/Notes', pinned: false, date: '2026-09-01T00:00:00Z' }]), 20)
    }
    if (name === 'quickOpen.cacheRecentFiles') {
      requests++
      if (requests === 1 || options.resend !== false) {
        setTimeout(() => options.via === 'initFileCache' ? panel.initFileCache(['/Synthetic/Indexed.md'], ['Indexed.md'], [1], 1, files) : panel.setRecentFiles(files), 30)
      }
      setTimeout(() => panel.updateCache('/Synthetic/Old.md', '/Synthetic/New.md', 'recentFiles'), 40)
    }
  })
  vi.stubGlobal('File', { isMac: true, isWK: true, isNode: false, editor: { quickOpenPanel: panel } })
  vi.stubGlobal('bridge', { callHandler })
  return { panel, callHandler }
}

async function run() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  expect((0, eval)(source)).toBeUndefined()
  await vi.advanceTimersByTimeAsync(15000)
  const report = log.mock.calls.map(call => String(call[0])).find(text => text.startsWith('Favorites Recent probe\n')) ?? ''
  return { report, log }
}

const own = (panel: object) => METHODS.filter(name => Object.prototype.hasOwnProperty.call(panel, name))

describe('Recent capability probe', () => {
  it('passes a macOS run that returns both lists twice, prints no paths, and restores Quick Open', async () => {
    const t = mac()
    const { report } = await run()
    expect(report).toContain('Pass 1'); expect(report).toContain('Pass 2')
    expect(report).toContain('setRecentFiles at 30 ms: 2 item(s), kinds: absolute path')
    expect(report).toContain('updateCache at 40 ms: removed absolute path, added absolute path, group recentFiles')
    expect(report).toContain('library.getRecentFolders answered at 20 ms: 2 item(s)')
    expect(report).toContain('date types: none, String'); expect(report).toContain('pinned at positions: 1')
    expect(report).toContain('RESULT: PASS')
    for (const secret of ['Synthetic', 'Pinned', '.md']) expect(report).not.toContain(secret)
    expect(own(t.panel)).toEqual([])
    expect(t.callHandler.mock.calls.filter(call => call[0] === 'quickOpen.cacheRecentFiles')).toHaveLength(2)
  })
  it('fails a macOS run whose second request gets no files list', async () => {
    mac({ resend: false })
    const { report } = await run()
    expect(report).toContain('RESULT: FAIL')
    expect(report).toContain('Pass 2 returned no full Recent files list, so Recent would work only once.')
  })
  it('accepts a files list that arrives through initFileCache', async () => {
    mac({ via: 'initFileCache' })
    const { report } = await run()
    expect(report).toContain('initFileCache at 30 ms: indexed 1 document(s); Recent files: 2 item(s), kinds: absolute path')
    expect(report).toContain('RESULT: PASS')
  })
  it('reports a folders call that never answers, and still finishes', async () => {
    mac({ folders: 'never' })
    const { report } = await run()
    expect(report).toContain('library.getRecentFolders: no answer after 5 s')
    expect(report).toContain('RESULT: FAIL')
    expect(globalThis).not.toHaveProperty('favoritesRecentProbe')
  })
  it('flags Recent files that are not absolute paths without printing them', async () => {
    mac({ files: ['file:///Synthetic/A.md'] })
    const { report } = await run()
    expect(report).toContain('Recent files that are not absolute paths (file URL)')
    expect(report).not.toContain('Synthetic')
  })
  it('names an existing hook on Quick Open and puts it back afterwards', async () => {
    const t = mac()
    const earlier = function (this: unknown, paths: unknown) { return Object.getPrototypeOf(t.panel).setRecentFiles.call(this, paths) }
    t.panel.setRecentFiles = earlier
    const { report } = await run()
    expect(report).toContain('Quick Open already hooked (another plugin or a Favorites build): setRecentFiles')
    expect(t.panel.setRecentFiles).toBe(earlier); expect(own(t.panel)).toEqual(['setRecentFiles'])
  })
  it('reports the Windows getter\'s shape without paths', async () => {
    vi.stubGlobal('File', { isNode: true, isMac: false })
    vi.stubGlobal('JSBridge', { invoke: vi.fn(async () => ({
      files: [{ name: 'A.md', path: 'C:\\Synthetic\\A.md', date: 1 }],
      folders: [{ name: 'Pinned', path: 'C:\\Synthetic\\Pinned', pinned: true, date: '2026-09-01T00:00:00.000Z' }],
    })) })
    const { report } = await run()
    expect(report).toContain('setting.getRecentFiles answered')
    expect(report).toContain('files: 1 item(s), kinds: {date name path}; date types: Number')
    expect(report).toContain('folders: 1 item(s), kinds: {date name path pinned}; date types: String')
    expect(report).toContain('files paths: absolute path')
    expect(report).toContain('RESULT: PASS')
    for (const secret of ['Synthetic', 'Pinned', 'A.md']) expect(report).not.toContain(secret)
  })
  it('reports a Windows getter that never answers instead of leaving a pending promise', async () => {
    vi.stubGlobal('File', { isNode: true })
    vi.stubGlobal('JSBridge', { invoke: vi.fn(() => new Promise(() => {})) })
    const { report } = await run()
    expect(report).toContain('setting.getRecentFiles: no answer after 5 s')
    expect(report).toContain('RESULT: FAIL')
  })
  it('refuses a second run while one is in progress', async () => {
    mac()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(0, eval)(source); (0, eval)(source)
    expect(log).toHaveBeenCalledWith('Favorites Recent probe is already running. Wait for its report.')
    await vi.advanceTimersByTimeAsync(15000)
    expect(document.querySelectorAll('[data-favorites-probe]')).toHaveLength(1)
  })
  it('shows the report in a selectable window that Close removes', async () => {
    mac()
    const { report } = await run()
    const box = document.querySelector<HTMLElement>('[data-favorites-probe]')!
    expect(box.querySelector('textarea')!.value).toBe(report)
    const buttons = [...box.querySelectorAll('button')]
    expect(buttons.map(button => button.textContent)).toEqual(['Copy report', 'Close'])
    buttons[0].click(); expect(buttons[0].textContent).toMatch(/Copied|Press Cmd\+C or Ctrl\+C to copy/)
    buttons[1].click(); expect(document.querySelector('[data-favorites-probe]')).toBeNull()
  })
})
