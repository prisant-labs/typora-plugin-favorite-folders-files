// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createState } from './model'
import type { QuickAccessController } from './controller'
import { openSettings } from './settings'
vi.mock('@typora-community-plugin/core', () => import('../test/support/typora-core'))
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })
describe('native settings modal cleanup', () => {
  it('removes every closed wrapper using jQuery cleanup and detaches each subscription once', () => {
    const remove = vi.fn((element: HTMLElement) => element.remove())
    vi.stubGlobal('$', (element: HTMLElement) => ({ remove: () => remove(element) }))
    const detach = vi.fn(); const closed = vi.fn()
    const controller = { subscribe: (listener: (snapshot: unknown) => void) => { listener({ state: createState() }); return detach }, change: vi.fn() } as unknown as QuickAccessController
    for (let index = 0; index < 3; index++) {
      const modal = openSettings(controller, closed)
      expect(document.querySelectorAll('.typ-modal__wrapper')).toHaveLength(1)
      modal.close(); modal.close()
      expect(document.querySelectorAll('.typ-modal__wrapper')).toHaveLength(0)
    }
    expect(remove).toHaveBeenCalledTimes(3); expect(detach).toHaveBeenCalledTimes(3); expect(closed).toHaveBeenCalledTimes(3)
  })
})
