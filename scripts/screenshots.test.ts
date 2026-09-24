import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findBrowser, screenshots } from './screenshots.mjs'

const root = resolve(import.meta.dirname, '..')

describe('README screenshots', () => {
  it('captures exactly the images the README shows, and each one exists', () => {
    const referenced = [...readFileSync(resolve(root, 'README.md'), 'utf8').matchAll(/docs\/images\/([a-z-]+)\.png/g)].map(match => match[1])
    expect([...new Set(referenced)].sort()).toEqual(screenshots.map(shot => shot.name).sort())
    for (const name of referenced) expect(existsSync(resolve(root, 'docs', 'images', `${name}.png`)), name).toBe(true)
  })

  it('prefers an explicit browser, then a known installation', () => {
    expect(findBrowser({ env: { SCREENSHOT_BROWSER: 'custom-browser' }, platform: 'win32', exists: () => false })).toBe('custom-browser')
    const edge = findBrowser({ env: {}, platform: 'win32', exists: path => path.includes('Edge') })
    expect(edge).toMatch(/msedge\.exe$/)
    expect(findBrowser({ env: {}, platform: 'linux', exists: () => false })).toBeUndefined()
  })
})
