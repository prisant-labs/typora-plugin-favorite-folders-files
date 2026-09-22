// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createState } from './model'
import { renderSettings } from './settings-ui'
describe('shared settings editor', () => {
  it('shows defaults and clamps count changes without nonfinite writes', () => {
    const container = document.createElement('div'); const change = vi.fn()
    const dispose = renderSettings(container, createState(), change)
    const [files, folders] = container.querySelectorAll<HTMLInputElement>('input')
    expect(files.value).toBe('20'); expect(folders.value).toBe('10')
    files.value = '150'; files.dispatchEvent(new Event('change')); expect(change).toHaveBeenLastCalledWith({ recentFiles: 100 })
    folders.value = '-3'; folders.dispatchEvent(new Event('change')); expect(change).toHaveBeenLastCalledWith({ recentFolders: 0 })
    files.value = ''; files.dispatchEvent(new Event('change')); expect(change).toHaveBeenCalledTimes(2)
    dispose(); expect(container.children).toHaveLength(0)
  })
})
