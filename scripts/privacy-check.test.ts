import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const checker = resolve(projectRoot, 'scripts/privacy-check.mjs')
const temporaryDirectories: string[] = []

function run(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [checker, '--repo', cwd, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'quick-access-privacy-'))
  temporaryDirectories.push(directory)
  git(directory, 'init', '-b', 'main')
  git(directory, 'config', 'user.name', 'Synthetic Tester')
  git(directory, 'config', 'user.email', 'tester@example.invalid')
  writeFileSync(join(directory, '.gitignore'), '_local/\n')
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('staged privacy gate', () => {
  it('passes ordinary synthetic source and reports the exact staged tree', () => {
    const directory = repository()
    writeFileSync(join(directory, 'safe.ts'), "export const label = 'Quick Access'\n")
    git(directory, 'add', '.gitignore', 'safe.ts')
    const tree = git(directory, 'write-tree')

    const result = run(directory, '--staged')

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`Tree: ${tree}`)
    expect(result.stdout).toContain('Result: pass')
  })

  it('rejects force-staged private paths', () => {
    const directory = repository()
    mkdirSync(join(directory, '_local'))
    writeFileSync(join(directory, '_local', 'private.md'), 'private fixture')
    git(directory, 'add', '.gitignore')
    git(directory, 'add', '-f', '_local/private.md')

    const result = run(directory, '--staged')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('_local/private.md')
  })

  it.each([
    [
      'Windows home path',
      () => ['C:', 'Users', 'synthetic-owner', 'notes'].join(String.fromCharCode(92)),
    ],
    ['macOS home path', () => ['', 'Users', 'synthetic-owner', 'notes'].join('/')],
    [
      'credential URL',
      () => ['https', '//synthetic-user', 'synthetic-password@example.test/repo'].join(':'),
    ],
    ['private key', () => ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')],
  ])('rejects a staged %s', (_label, buildContent) => {
    const directory = repository()
    writeFileSync(join(directory, 'unsafe.txt'), buildContent())
    git(directory, 'add', '.gitignore', 'unsafe.txt')

    const result = run(directory, '--staged')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unsafe.txt')
  })

  it('rejects staged binary content it cannot inspect', () => {
    const directory = repository()
    writeFileSync(join(directory, 'opaque.bin'), Buffer.from([0, 1, 2, 3]))
    git(directory, 'add', '.gitignore', 'opaque.bin')

    const result = run(directory, '--staged')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('opaque.bin')
  })
})
