import { describe, expect, it, vi } from 'vitest'
import { BrowseListError, macBrowseSource, macCommandRunner, nodeBrowseSource, shellQuote, type MacCommandResult, type NodeDirent } from './browse-fs'

const dirent = (name: string, type: 'dir' | 'file' | 'link' | 'other'): NodeDirent => ({
  name, isDirectory: () => type === 'dir', isFile: () => type === 'file', isSymbolicLink: () => type === 'link',
})
const failure = (code: string) => Object.assign(new Error(`${code}: synthetic message naming C:/Synthetic/Private`), { code })

describe('Browse on Windows (Node file system)', () => {
  it('lists folders, then Markdown files, in natural order and hides system and hidden entries', async () => {
    const readdir = vi.fn(async () => [
      dirent('notes 10.md', 'file'), dirent('Zeta', 'dir'), dirent('notes 2.md', 'file'), dirent('alpha', 'dir'),
      dirent('.git', 'dir'), dirent('$Recycle.Bin', 'dir'), dirent('System Volume Information', 'dir'),
      dirent('image.png', 'file'), dirent('README.markdown', 'file'), dirent('socket', 'other'),
      dirent('Linked folder', 'link'), dirent('Linked note.md', 'link'), dirent('Broken link', 'link'),
    ])
    const stat = vi.fn(async (path: string) => {
      if (path.endsWith('Broken link')) throw failure('ENOENT')
      return { isDirectory: () => path.endsWith('Linked folder'), isFile: () => path.endsWith('.md') }
    })
    const source = nodeBrowseSource({ readdir, stat }, 'win32')
    const entries = await source.list('C:/Synthetic')
    expect(entries.map(entry => `${entry.kind}:${entry.name}`)).toEqual([
      'folder:alpha', 'folder:Linked folder', 'folder:Zeta', 'file:Linked note.md', 'file:notes 2.md', 'file:notes 10.md', 'file:README.markdown',
    ])
    expect(entries[0].path).toBe('C:/Synthetic/alpha')
    expect(readdir).toHaveBeenCalledWith('C:/Synthetic', { withFileTypes: true })
    // Hidden names are never resolved.
    expect(stat.mock.calls.map(([path]) => path).sort()).toEqual(['C:/Synthetic/Broken link', 'C:/Synthetic/Linked folder', 'C:/Synthetic/Linked note.md'])
  })

  it('joins children onto a drive root', async () => {
    const source = nodeBrowseSource({ readdir: async () => [dirent('Users', 'dir')], stat: vi.fn() }, 'win32')
    await expect(source.list('D:/')).resolves.toEqual([{ kind: 'folder', name: 'Users', path: 'D:/Users' }])
  })

  it('reports a folder it cannot list without naming the path', async () => {
    for (const [code, reason, message] of [['EPERM', 'denied', 'No access'], ['EACCES', 'denied', 'No access'], ['ENOENT', 'missing', 'Unavailable'], ['ENOTDIR', 'missing', 'Unavailable'], ['EIO', 'failed', 'Could not be read']] as const) {
      const source = nodeBrowseSource({ readdir: async () => { throw failure(code) }, stat: vi.fn() }, 'win32')
      const error = await source.list('C:/Synthetic/Private').catch(caught => caught)
      expect(error).toBeInstanceOf(BrowseListError)
      expect(error).toMatchObject({ reason, message })
      expect(String(error.message)).not.toContain('Synthetic')
    }
  })

  it('finds drives by probing drive letters, at most two at a time', async () => {
    let running = 0, peak = 0
    const stat = vi.fn(async (path: string) => {
      running++; peak = Math.max(peak, running)
      await new Promise(resolve => setTimeout(resolve, 1))
      running--
      if (!['C:/', 'E:/'].includes(path)) throw failure('ENOENT')
      return { isDirectory: () => true, isFile: () => false }
    })
    const source = nodeBrowseSource({ readdir: vi.fn(), stat }, 'win32')
    await expect(source.drives()).resolves.toEqual(['C:/', 'E:/'])
    expect(stat).toHaveBeenCalledTimes(24)
    expect(stat.mock.calls[0][0]).toBe('C:/')
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('normalizes the home folder and hides it when it cannot be read', () => {
    expect(nodeBrowseSource({ readdir: vi.fn(), stat: vi.fn() }, 'win32', () => 'C:\\Users\\Synthetic').home()).toBe('C:/Users/Synthetic')
    expect(nodeBrowseSource({ readdir: vi.fn(), stat: vi.fn() }, 'win32', () => { throw new Error('no home') }).home()).toBeUndefined()
    expect(nodeBrowseSource({ readdir: vi.fn(), stat: vi.fn() }, 'win32').home()).toBeUndefined()
  })

  it('shows names that start with $ outside Windows', async () => {
    const source = nodeBrowseSource({ readdir: async () => [dirent('$money', 'dir')], stat: vi.fn() }, 'linux')
    await expect(source.list('/Synthetic')).resolves.toEqual([{ kind: 'folder', name: '$money', path: '/Synthetic/$money' }])
    await expect(source.drives()).resolves.toEqual(['/'])
  })
})

describe('Browse on macOS (shell listing)', () => {
  const result = (out: string, ok = true, error = ''): MacCommandResult => ({ ok, out, error })

  it('quotes paths for the shell, including apostrophes', () => {
    expect(shellQuote('/Synthetic/It\'s here')).toBe(`'/Synthetic/It'\\''s here'`)
    expect(shellQuote('/Synthetic/$(touch x) `y` "z"')).toBe(`'/Synthetic/$(touch x) \`y\` "z"'`)
  })

  it('lists with one quoted ls command and parses folders and Markdown files', async () => {
    const run = vi.fn(async (_command: string) => result('Zeta/\nalpha/\nnotes 10.md\nimage.png\nnotes 2.md\n'))
    const entries = await macBrowseSource(run).list('/Synthetic/It\'s here')
    expect(run).toHaveBeenCalledExactlyOnceWith(`/bin/ls -1pL '/Synthetic/It'\\''s here'`)
    expect(entries).toEqual([
      { kind: 'folder', name: 'alpha', path: '/Synthetic/It\'s here/alpha' }, { kind: 'folder', name: 'Zeta', path: '/Synthetic/It\'s here/Zeta' },
      { kind: 'file', name: 'notes 2.md', path: '/Synthetic/It\'s here/notes 2.md' }, { kind: 'file', name: 'notes 10.md', path: '/Synthetic/It\'s here/notes 10.md' },
    ])
  })

  it('keeps what ls printed when one entry could not be read', async () => {
    const run = vi.fn(async () => result('alpha/\n', false, 'ls: /Synthetic/broken: No such file or directory'))
    await expect(macBrowseSource(run).list('/Synthetic')).resolves.toEqual([{ kind: 'folder', name: 'alpha', path: '/Synthetic/alpha' }])
  })

  it('reports a folder it cannot list without naming the path', async () => {
    for (const [error, reason] of [['ls: /Synthetic/Private: Permission denied', 'denied'], ['ls: /Synthetic/Private: Operation not permitted', 'denied'], ['ls: /Synthetic/Private: No such file or directory', 'missing'], ['something else', 'failed']] as const) {
      const caught = await macBrowseSource(async () => result('', false, error)).list('/Synthetic/Private').catch(value => value)
      expect(caught).toBeInstanceOf(BrowseListError); expect(caught.reason).toBe(reason); expect(caught.message).not.toContain('Synthetic')
    }
    const thrown = await macBrowseSource(async () => { throw new Error('bridge gone') }).list('/Synthetic').catch(value => value)
    expect(thrown).toMatchObject({ reason: 'failed', message: 'Could not be read' })
  })

  it('lists mounted volumes as drives', async () => {
    const run = vi.fn(async () => result('Macintosh HD/\nArchive/\n'))
    await expect(macBrowseSource(run).drives()).resolves.toEqual(['/Volumes/Archive', '/Volumes/Macintosh HD'])
    expect(run).toHaveBeenCalledWith(`/bin/ls -1pL '/Volumes'`)
    await expect(macBrowseSource(async () => result('', false, 'denied')).drives()).resolves.toEqual([])
  })

  it('runs commands through Typora\'s runCommand bridge, with a timeout', async () => {
    const callHandler = vi.fn((_name: string, _options: unknown, callback: (value: unknown[]) => void) => callback([true, 'alpha/\n', '']))
    const run = macCommandRunner(() => ({ callHandler }), () => '/Synthetic/Open folder')
    await expect(run('/bin/ls')).resolves.toEqual({ ok: true, out: 'alpha/\n', error: '' })
    expect(callHandler).toHaveBeenCalledWith('controller.runCommand', { cwd: '/Synthetic/Open folder', args: '/bin/ls' }, expect.any(Function))
    // With no folder open, the command runs from the file system root.
    await macCommandRunner(() => ({ callHandler }), () => undefined)('/bin/ls')
    expect(callHandler.mock.calls[1][1]).toEqual({ cwd: '/', args: '/bin/ls' })
    await expect(macCommandRunner(() => undefined, () => '/')('/bin/ls')).rejects.toThrow()
    vi.useFakeTimers()
    try {
      const silent = macCommandRunner(() => ({ callHandler: vi.fn() }), () => '/', 50)('/bin/ls')
      const settled = expect(silent).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(60); await settled
    } finally { vi.useRealTimers() }
  })
})
