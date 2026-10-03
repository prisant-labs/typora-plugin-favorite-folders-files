// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@typora-community-plugin/core', () => import('../test/support/typora-core'))
import { openUpdateConfirmation } from './update-dialog'

afterEach(() => { document.body.replaceChildren() })

function open(overrides: Partial<Parameters<typeof openUpdateConfirmation>[0]> = {}) {
  const opener = document.createElement('button'); opener.textContent = 'pill'; document.body.append(opener); opener.focus()
  const dialog = openUpdateConfirmation({ installed: '0.1.3', version: '0.1.5', repo: 'prisant-labs/typora-plugin-favorite-folders-files', confirm: vi.fn(async () => {}), ...overrides })
  const wrapper = document.querySelector<HTMLElement>('.typ-modal__wrapper')!
  const button = (name: string) => [...wrapper.querySelectorAll('button')].find(node => node.textContent === name)!
  return { opener, dialog, wrapper, button }
}

describe('openUpdateConfirmation', () => {
  it('focuses Cancel, so Escape and Enter act on the dialog and not on what opened it', () => {
    const { button } = open()
    expect(document.activeElement).toBe(button('Cancel'))
  })

  it('returns focus to the pill and removes the dialog when it closes', () => {
    const { opener, wrapper, button } = open()
    button('Cancel').click()
    expect(document.activeElement).toBe(opener)
    expect(wrapper.isConnected).toBe(false)
  })

  it('removes the dialog when the plugin closes it during an update', () => {
    const { opener, dialog, wrapper } = open()
    opener.remove(); dialog.close()
    expect(wrapper.isConnected).toBe(false)
    expect(document.activeElement).toBe(document.body)
  })

  it('opens the release link through the host', () => {
    const openLink = vi.fn()
    const { wrapper } = open({ openLink })
    wrapper.querySelector('a')!.click()
    expect(openLink).toHaveBeenCalledOnce()
  })
})
