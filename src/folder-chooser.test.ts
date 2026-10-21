import { describe, expect, it, vi } from 'vitest'
import { folderChooser } from './folder-chooser'

describe('folder chooser', () => {
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
