import { describe, expect, it, vi } from 'vitest'
import { NativeHost } from './host'

function fixture(platform: 'win32' | 'darwin' = 'win32') {
  const app = { platform, vault: { path: '', on: vi.fn(() => vi.fn()) }, workspace: { activeFile: '', activeEditor: { openFile: vi.fn() }, on: vi.fn(() => vi.fn()) }, openFile: vi.fn(async () => {}) }
  const services = { stat: vi.fn(async () => ({ isFile: (): boolean => true, isDirectory: (): boolean => false })), invoke: vi.fn(async () => {}), showInFinder: vi.fn(async () => {}) }
  return { app, services, host: new NativeHost(app, services) }
}
describe('native path adapter', () => {
  it('passes a Windows apostrophe path unchanged as an argument, converting separators', async () => {
    const f = fixture(); await f.host.open('file', "C:/Synthetic/Editor's note.md")
    expect(f.app.openFile).toHaveBeenCalledWith("C:\\Synthetic\\Editor's note.md")
  })
  it('rejects unsupported files and wrong-kind or missing targets before dispatch', async () => {
    const f = fixture(); await expect(f.host.open('file', 'C:/Synthetic/script.exe')).rejects.toThrow('Favorites opens Markdown files only.')
    await expect(f.host.open('folder', 'C:/Synthetic')).rejects.toThrow('Your Favorite is preserved.')
    expect(f.services.invoke).not.toHaveBeenCalled(); expect(f.app.openFile).not.toHaveBeenCalled()
  })
  it('isolates folder switching and OS actions', async () => {
    const f = fixture(); f.services.stat.mockResolvedValue({ isDirectory: () => true, isFile: () => false })
    await f.host.open('folder', 'C:/Synthetic/Notes')
    expect(f.services.invoke).toHaveBeenCalledWith('controller.switchFolder', 'C:\\Synthetic\\Notes')
    await f.host.reveal('folder', 'C:/Synthetic/Notes')
    expect(f.services.invoke).toHaveBeenCalledWith('shell.openItem', 'C:\\Synthetic\\Notes')
  })
  it('does not re-switch to the folder already open, as Typora\'s own switcher does', async () => {
    const f = fixture(); f.services.stat.mockResolvedValue({ isDirectory: () => true, isFile: () => false })
    f.app.vault.path = 'c:\\synthetic\\notes'
    await f.host.open('folder', 'C:/Synthetic/Notes')
    expect(f.services.invoke).not.toHaveBeenCalled()
    await f.host.open('folder', 'C:/Synthetic/Other')
    expect(f.services.invoke).toHaveBeenCalledWith('controller.switchFolder', 'C:\\Synthetic\\Other')
  })
  it('opens a new window on request with Typora\'s own Ctrl+click command on Windows only', async () => {
    const f = fixture(); f.services.stat.mockResolvedValue({ isDirectory: () => true, isFile: () => false })
    f.app.vault.path = 'C:\\Synthetic\\Notes'
    await f.host.open('folder', 'C:/Synthetic/Notes', { newWindow: true })
    expect(f.services.invoke).toHaveBeenCalledExactlyOnceWith('app.openFileOrFolder', 'C:\\Synthetic\\Notes', { forceCreateWindow: true })
    const mac = fixture('darwin'); await mac.host.open('file', '/Synthetic/note.md', { newWindow: true })
    expect(mac.services.invoke).not.toHaveBeenCalled(); expect(mac.app.workspace.activeEditor.openFile).toHaveBeenCalledOnce()
  })
  it('never uses mac shell-based fs checks, including apostrophe and hash names', async () => {
    const f = fixture('darwin'); await f.host.open('file', "/Synthetic/Editor's #note.md")
    expect(f.services.stat).not.toHaveBeenCalled()
    expect(f.app.workspace.activeEditor.openFile).toHaveBeenCalledWith({ pathname: "/Synthetic/Editor's #note.md" })
    await f.host.reveal('file', "/Synthetic/Editor's note.md")
    expect(f.services.showInFinder).toHaveBeenCalledWith("/Synthetic/Editor's note.md")
  })
  it.each([
    "/Synthetic/Editor's #notes/note.md",
    "/Synthetic/Editor's ?notes/note.md",
    "/Synthetic/Editor's notes/note?one.md",
    "/Synthetic/Editor's notes/note#one.md",
    "/Synthetic/Editor's notes/plain.md",
  ])('passes the entire mac Markdown path directly to the public editor: %s', async path => {
    const f = fixture('darwin'); await f.host.open('file', path)
    expect(f.app.workspace.activeEditor.openFile).toHaveBeenCalledWith({ pathname: path })
    expect(f.app.openFile).not.toHaveBeenCalled()
    expect(f.services.stat).not.toHaveBeenCalled(); expect(f.services.invoke).not.toHaveBeenCalled()
  })
  it('does not dispatch after unload while an availability check is pending', async () => {
    const f = fixture(); let release!: (value: { isFile(): boolean; isDirectory(): boolean }) => void
    f.services.stat.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const open = f.host.open('file', 'C:/Synthetic/note.md')
    f.host.dispose(); release({ isFile: () => true, isDirectory: () => false }); await open
    expect(f.app.openFile).not.toHaveBeenCalled()
  })
  it('checks mac folders using the argument-based native directory capability', async () => {
    const f = fixture('darwin'); const isDirectory = vi.fn(async () => false)
    const host = new NativeHost(f.app, { ...f.services, isDirectory })
    await expect(host.open('folder', "/Synthetic/Editor's notes")).rejects.toThrow('Your Favorite is preserved.')
    expect(isDirectory).toHaveBeenCalledWith("/Synthetic/Editor's notes")
    expect(f.services.stat).not.toHaveBeenCalled(); expect(f.services.invoke).not.toHaveBeenCalled()
  })
})
