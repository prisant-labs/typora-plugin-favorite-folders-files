import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..')

function readJson(relativePath: string): Record<string, unknown> {
  const path = resolve(root, relativePath)
  expect(existsSync(path), `${relativePath} must exist`).toBe(true)
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('approved public metadata', () => {
  it('uses the approved package identity', () => {
    const pkg = readJson('package.json')

    expect(pkg).toMatchObject({
      private: true,
      name: 'typora-plugin-favorite-folders-files',
      version: '0.1.1',
      author: 'Prisant Labs',
      license: 'MIT',
    })
  })

  it('uses the approved manifest identity and support boundary', () => {
    const manifest = readJson('src/manifest.json')

    expect(manifest).toEqual({
      id: 'prisant-labs.favorite-folders-files',
      name: 'Favorites',
      description: 'Keep favorite folders and Markdown files within reach in Typora.',
      author: 'Prisant Labs',
      authorUrl: 'https://github.com/prisant-labs',
      repo: 'prisant-labs/typora-plugin-favorite-folders-files',
      version: '0.1.1',
      minAppVersion: '1.4.0',
      minCoreVersion: '2.10.21',
      platforms: ['win32', 'darwin'],
    })
  })

  it('ships the approved public title and license', () => {
    const readme = resolve(root, 'README.md')
    const license = resolve(root, 'LICENSE.md')

    expect(readFileSync(readme, 'utf8')).toMatch(/^# Favorites for Typora$/m)
    expect(existsSync(license), 'LICENSE.md must exist').toBe(true)
    if (existsSync(license)) {
      expect(readFileSync(license, 'utf8')).toContain(
        'Copyright (c) 2026 Prisant Labs',
      )
    }
  })
})
