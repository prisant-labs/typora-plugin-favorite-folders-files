// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyOperation, createState, type Operation } from './model'
vi.mock('@typora-community-plugin/core', () => import('../test/support/typora-core'))
vi.mock('./storage', () => ({ IndexedDbStore: class {
  state = createState()
  async read() { return this.state }
  async update(op: Operation) { return this.state = applyOperation(this.state, op, 'win32') }
  async close() {}
} }))
import QuickAccessPlugin from './main'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren() })

describe('plugin lifecycle', () => {
  it('registers ribbon, sidebar, settings, and commands; unload removes DOM and prevents stale resurrection', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('$', (element: HTMLElement) => ({ remove: () => element.remove() }))
    const unsubscribe = vi.fn(); const remove = vi.fn()
    const app = {
      platform: 'win32', openFile: vi.fn(),
      vault: { path: 'C:/Synthetic', on: vi.fn(() => unsubscribe) },
      workspace: {
        activeFile: 'C:/Synthetic/note.md', activeEditor: { openFile: vi.fn() }, on: vi.fn(() => unsubscribe), ribbon: {},
        sidebar: { addPanel: vi.fn((_panel: unknown) => remove), switch: vi.fn(), container: { addPanel: (panel: { containerEl: HTMLElement }) => document.body.append(panel.containerEl), removePanel: (panel: { containerEl: HTMLElement }) => panel.containerEl.remove() } },
      },
    }
    const plugin = new QuickAccessPlugin(app as never, { id: 'prisant-labs.quick-access', name: 'Quick Access' } as never)
    plugin.onload(); await vi.advanceTimersByTimeAsync(0)
    const panel = app.workspace.sidebar.addPanel.mock.calls[0]?.[0] as { containerEl: HTMLElement; show(): void; ribbonButton: { id: string; title: string } }
    expect(panel.ribbonButton).toMatchObject({ id: 'prisant-labs.quick-access', title: 'Quick Access' })
    panel.show(); expect(document.querySelector('.quick-access')).not.toBeNull()
    expect(app.workspace.on).toHaveBeenCalledWith('file:open', expect.any(Function))
    const commands = (plugin as unknown as { commands: { title: string; callback(): void }[] }).commands
    expect(commands.map(command => command.title)).toEqual(['Quick Access: Toggle panel', 'Quick Access: Settings'])
    commands[1].callback(); commands[1].callback()
    expect(document.querySelectorAll('.typ-modal__wrapper')).toHaveLength(1)
    plugin.onunload()
    expect(remove).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0); expect(document.querySelector('.quick-access')).toBeNull()
    expect(document.querySelectorAll('.typ-modal__wrapper')).toHaveLength(0)
    panel.show(); expect(document.querySelector('.quick-access')).toBeNull()
  })
})
