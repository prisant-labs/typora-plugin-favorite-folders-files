import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const temporaryDirectories: string[] = []
const releaseFiles = [
  'LICENSE.md',
  'THIRD-PARTY-NOTICES.md',
  'main.js',
  'manifest.json',
  'style.css',
]

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'quick-access-pack-'))
  temporaryDirectories.push(directory)
  const dist = join(directory, 'dist')
  const output = join(directory, 'plugin.zip')
  const brandedOutput = join(
    directory,
    'plugin_typora-quick-access-folder-files.zip',
  )
  mkdirSync(dist)
  for (const name of releaseFiles) writeFileSync(join(dist, name), `fixture:${name}`)
  writeFileSync(join(dist, 'private-notes.md'), 'must not ship')
  return { directory, dist, output, brandedOutput }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('plugin packer', () => {
  it('archives only the approved files and writes an identical branded copy', () => {
    const { dist, output, brandedOutput } = fixture()
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, 'pack.js'),
        '--dist', dist,
        '--output', output,
        '--branded-output', brandedOutput,
      ],
      { cwd: root, encoding: 'utf8' },
    )

    expect(result.status, result.stderr).toBe(0)
    const archive = unzipSync(new Uint8Array(readFileSync(output)))
    expect(Object.keys(archive).sort()).toEqual([...releaseFiles].sort())
    for (const [name, bytes] of Object.entries(archive)) {
      expect(new TextDecoder().decode(bytes)).toBe(`fixture:${basename(name)}`)
    }
    expect(readFileSync(brandedOutput)).toEqual(readFileSync(output))
  })

  it('fails closed when an allowlisted file is missing', () => {
    const { dist, output, brandedOutput } = fixture()
    rmSync(join(dist, 'style.css'))
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, 'pack.js'),
        '--dist', dist,
        '--output', output,
        '--branded-output', brandedOutput,
      ],
      { cwd: root, encoding: 'utf8' },
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('style.css')
  })
})
