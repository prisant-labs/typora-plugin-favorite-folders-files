import { describe, expect, it, vi } from 'vitest'
import { folderChooser, markdownFileChooser } from './folder-chooser'

describe('Markdown file chooser', () => {
  const extensions = ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'rmd', 'qmd']

  it('asks Typora for one Markdown file on Windows, without adding it to the Recent list', async () => {
    const invoke = vi.fn(async () => ({ canceled: false, filePaths: ['D:\\Notes\\Plan.md'] }))
    const choose = markdownFileChooser('win32', { windows: () => ({ invoke }) })!
    await expect(choose('C:/Example/Notes')).resolves.toBe('D:\\Notes\\Plan.md')
    expect(invoke).toHaveBeenCalledWith('dialog.showOpenDialog', {
      title: 'Choose a Markdown file for Favorites', defaultPath: 'C:\\Example\\Notes',
      filters: [{ name: 'Markdown', extensions }], properties: ['openFile', 'dontAddToRecent'], buttonLabel: 'Choose',
    })
  })

  it('asks Typora for a file on macOS, as Typora asks for one, and reads a path or a file URL', async () => {
    const replies: unknown[] = ['/Example/Plan.md', 'file:///Volumes/Travel%20Drive/Plan.md', null]
    const callHandler = vi.fn((_name: string, _data: unknown, callback: (result: unknown) => void) => callback(replies.shift()))
    const choose = markdownFileChooser('darwin', { mac: () => ({ callHandler }) })!
    await expect(choose('/Example')).resolves.toBe('/Example/Plan.md')
    expect(callHandler).toHaveBeenCalledWith('path.selectFolderOrFile', { dir: false, defaultPath: '/Example', filters: [extensions] }, expect.any(Function))
    await expect(choose()).resolves.toBe('/Volumes/Travel Drive/Plan.md')
    await expect(choose()).resolves.toBeUndefined()
  })

  it('is absent without a dialog bridge, and treats a cancelled Windows dialog as no choice', async () => {
    expect(markdownFileChooser('win32', { windows: () => undefined })).toBeUndefined()
    expect(markdownFileChooser('darwin', { mac: () => undefined })).toBeUndefined()
    expect(markdownFileChooser('linux', { windows: () => ({ invoke: vi.fn() }) })).toBeUndefined()
    const choose = markdownFileChooser('win32', { windows: () => ({ invoke: async () => ({ canceled: true, filePaths: [] }) }) })!
    await expect(choose()).resolves.toBeUndefined()
  })
})

describe('folder chooser', () => {
  it('titles the Windows dialog for what the folder is for', async () => {
    const invoke = vi.fn(async () => ({ filePaths: [] }))
    await folderChooser('win32', { windows: () => ({ invoke }) })!(undefined, 'Choose a folder for Favorites')
    expect(invoke).toHaveBeenCalledWith('dialog.showOpenDialog', expect.objectContaining({ title: 'Choose a folder for Favorites' }))
  })

  it('asks Typora for one folder on Windows, without adding it to the Recent list', async () => {
    const invoke = vi.fn(async () => ({ canceled: false, filePaths: ['D:\\Notes\\Archive'] }))
    const choose = folderChooser('win32', { windows: () => ({ invoke }) })!
    await expect(choose('C:/Example/Notes')).resolves.toBe('D:\\Notes\\Archive')
    expect(invoke).toHaveBeenCalledWith('dialog.showOpenDialog', {
      title: 'Choose a folder for Browse', defaultPath: 'C:\\Example\\Notes',
      properties: ['openDirectory', 'dontAddToRecent'], buttonLabel: 'Choose',
    })
  })

  it('treats a cancelled or empty Windows dialog as no choice', async () => {
    for (const result of [{ canceled: true, filePaths: [] }, { filePaths: [''] }, undefined, { filePaths: 'D:\\Notes' }]) {
      const choose = folderChooser('win32', { windows: () => ({ invoke: async () => result }) })!
      await expect(choose()).resolves.toBeUndefined()
    }
  })

  it('asks Typora for a folder on macOS and reads a path or a file URL', async () => {
    const replies: unknown[] = ['/Example/It\'s here', 'file:///Volumes/Travel%20Drive/', '', null]
    const callHandler = vi.fn((_name: string, _data: unknown, callback: (result: unknown) => void) => callback(replies.shift()))
    const choose = folderChooser('darwin', { mac: () => ({ callHandler }) })!
    await expect(choose('/Example')).resolves.toBe('/Example/It\'s here')
    expect(callHandler).toHaveBeenCalledWith('path.selectFolderOrFile', { dir: true, defaultPath: '/Example' }, expect.any(Function))
    await expect(choose()).resolves.toBe('/Volumes/Travel Drive/')
    await expect(choose()).resolves.toBeUndefined()
    await expect(choose()).resolves.toBeUndefined()
  })

  it('is absent when the Typora window has no dialog bridge, and fails when the bridge throws', async () => {
    expect(folderChooser('win32', { windows: () => undefined })).toBeUndefined()
    expect(folderChooser('darwin', { mac: () => undefined })).toBeUndefined()
    expect(folderChooser('linux', { windows: () => ({ invoke: vi.fn() }) })).toBeUndefined()
    const choose = folderChooser('darwin', { mac: () => ({ callHandler: () => { throw new Error('bridge gone') } }) })!
    await expect(choose()).rejects.toThrow('bridge gone')
  })
})
