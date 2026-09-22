import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@typora-community-plugin/core', () => ({
  Plugin: class Plugin {},
}))

describe('foundation plugin entry', () => {
  it('exports a lifecycle-only Community Plugin subclass', async () => {
    const entryPath = resolve(import.meta.dirname, 'main.ts')
    expect(existsSync(entryPath), 'src/main.ts must exist').toBe(true)
    if (!existsSync(entryPath)) return

    const [{ default: QuickAccessPlugin }, { Plugin }] = await Promise.all([
      import('./main'),
      import('@typora-community-plugin/core'),
    ])

    const plugin = new QuickAccessPlugin({} as never, {} as never)
    expect(plugin).toBeInstanceOf(Plugin)
    expect(plugin.onload()).toBeUndefined()
    expect(plugin.onunload()).toBeUndefined()
  })
})
