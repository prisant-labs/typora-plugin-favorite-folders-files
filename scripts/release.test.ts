import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { validateMetadata, validatePayload } from './release.mjs'

const root = resolve(import.meta.dirname, '..')
const manifest = {
  id: 'prisant-labs.quick-access',
  name: 'Quick Access',
  description: 'Keep pinned and recent folders and files within reach in Typora.',
  author: 'Prisant Labs',
  authorUrl: 'https://github.com/prisant-labs',
  repo: 'prisant-labs/typora-plugin-quick-access-folder-files',
  version: '0.1.0',
  minAppVersion: '1.4.0',
  minCoreVersion: '2.10.21',
  platforms: ['win32', 'darwin'],
}
const pkg = {
  private: true,
  name: 'typora-plugin-quick-access-folder-files',
  description: manifest.description,
  author: manifest.author,
  license: 'MIT',
  version: manifest.version,
  devDependencies: { '@typora-community-plugin/core': '2.10.21' },
}
const files = Object.fromEntries([
  'LICENSE.md',
  'THIRD-PARTY-NOTICES.md',
  'main.js',
  'manifest.json',
  'style.css',
].map(name => [name, Buffer.from(name)]))

it('declares the exact flat release allowlist', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/release.mjs'), '--print-files'],
    { cwd: root, encoding: 'utf8' },
  )

  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout.trim().split(/\r?\n/)).toEqual([
    'LICENSE.md',
    'THIRD-PARTY-NOTICES.md',
    'main.js',
    'manifest.json',
    'style.css',
  ])
})

describe('release metadata gate', () => {
  it('accepts consistent source, build, and exact optional release tag', () => {
    expect(() => validateMetadata(manifest, pkg, { ...manifest }, '0.1.0')).not.toThrow()
  })

  it('rejects version, built-manifest, tag, identity, and core-pin drift', () => {
    expect(() => validateMetadata(
      manifest,
      { ...pkg, version: '0.0.9' },
      manifest,
    )).toThrow(/version/i)
    expect(() => validateMetadata(
      manifest,
      pkg,
      { ...manifest, platforms: ['win32'] },
    )).toThrow(/manifest/i)
    expect(() => validateMetadata(manifest, pkg, manifest, 'v0.1.0')).toThrow(/tag/i)
    expect(() => validateMetadata(
      { ...manifest, id: 'other.plugin' },
      pkg,
      { ...manifest, id: 'other.plugin' },
    )).toThrow(/metadata/i)
    expect(() => validateMetadata(
      manifest,
      {
        ...pkg,
        devDependencies: { '@typora-community-plugin/core': '^2.10.21' },
      },
      manifest,
    )).toThrow(/core/i)
  })
})

describe('release ZIP payload gate', () => {
  it('accepts only required nonempty files matching the build bytes', () => {
    expect(() => validatePayload(files, files)).not.toThrow()
  })

  it('rejects missing, private, empty, and stale entries', () => {
    const { 'LICENSE.md': _license, ...withoutLicense } = files
    expect(() => validatePayload(withoutLicense, files)).toThrow(/entries/i)
    expect(() => validatePayload(
      { ...files, '_local/notes.md': Buffer.from('private') },
      files,
    )).toThrow(/entries/i)
    expect(() => validatePayload(
      { ...files, 'main.js': Buffer.alloc(0) },
      files,
    )).toThrow(/main.js/i)
    expect(() => validatePayload(
      { ...files, 'style.css': Buffer.from('stale') },
      files,
    )).toThrow(/style.css/i)
  })
})
