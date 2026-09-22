import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { unzipSync } from 'fflate'

export const releaseFiles = [
  'LICENSE.md',
  'THIRD-PARTY-NOTICES.md',
  'main.js',
  'manifest.json',
  'style.css',
]

const approvedManifest = {
  id: 'prisant-labs.quick-access',
  name: 'Quick Access',
  description: 'Keep pinned and recent folders and files within reach in Typora.',
  author: 'Prisant Labs',
  authorUrl: 'https://github.com/prisant-labs',
  repo: 'prisant-labs/typora-plugin-quick-access-folder-files',
  minAppVersion: '1.4.0',
  minCoreVersion: '2.10.21',
  platforms: ['win32', 'darwin'],
}

const approvedPackage = {
  private: true,
  name: 'typora-plugin-quick-access-folder-files',
  description: approvedManifest.description,
  author: approvedManifest.author,
  license: 'MIT',
}

export function validateMetadata(source, pkg, built, tag) {
  assert.deepEqual(
    source,
    { ...approvedManifest, version: source.version },
    'Source manifest differs from approved public metadata',
  )

  for (const [key, expected] of Object.entries(approvedPackage)) {
    assert.deepEqual(pkg[key], expected, `Unexpected package metadata: ${key}`)
  }

  assert.match(source.version, /^\d+\.\d+\.\d+$/, 'Expected a semantic release version')
  assert.equal(pkg.version, source.version, 'Package and manifest version differ')
  assert.equal(
    pkg.devDependencies?.['@typora-community-plugin/core'],
    source.minCoreVersion,
    'Core must be pinned to the tested minimum',
  )
  assert.deepEqual(built, source, 'Built manifest differs from source manifest')

  if (tag !== undefined) {
    assert.equal(tag, source.version, 'Release tag must exactly match version (no v prefix)')
  }
}

export function validatePayload(actual, expected) {
  assert.deepEqual(
    Object.keys(actual).sort(),
    [...releaseFiles].sort(),
    'Unexpected or missing ZIP entries',
  )

  for (const name of releaseFiles) {
    assert.ok(actual[name].length > 0, `Empty release file: ${name}`)
    assert.deepEqual(
      Buffer.from(actual[name]),
      Buffer.from(expected[name]),
      `ZIP differs from build: ${name}`,
    )
  }
}

// This validates locally built archives; it is not an untrusted ZIP extraction API.
export async function validateRelease(root = process.cwd(), tag) {
  const read = relativePath => readFile(path.join(root, relativePath))
  const readJson = async relativePath => JSON.parse((await read(relativePath)).toString('utf8'))

  const sourceManifest = await readJson('src/manifest.json')
  const packageJson = await readJson('package.json')
  const builtManifest = await readJson('dist/manifest.json')
  validateMetadata(sourceManifest, packageJson, builtManifest, tag)

  const expectedEntries = Object.fromEntries(
    await Promise.all(
      releaseFiles.map(async name => {
        const contents = await read(path.join('dist', name))
        assert.ok(contents.length > 0, `Empty build artifact: ${name}`)
        return [name, contents]
      }),
    ),
  )

  for (const name of ['LICENSE.md', 'THIRD-PARTY-NOTICES.md']) {
    assert.deepEqual(expectedEntries[name], await read(name), `Stale release notice: ${name}`)
  }

  const archive = await read('plugin.zip')
  assert.ok(archive.length > 0, 'Empty release archive: plugin.zip')
  assert.deepEqual(
    await read('plugin_typora-quick-access-folder-files.zip'),
    archive,
    'Branded ZIP differs from plugin.zip',
  )
  validatePayload(unzipSync(archive), expectedEntries)

  return {
    version: sourceManifest.version,
    files: releaseFiles,
    sha256: createHash('sha256').update(archive).digest('hex'),
  }
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--print-files') {
    return { command: 'print-files' }
  }

  let check = false
  let tag
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--check') {
      assert.equal(check, false, '--check may only be specified once')
      check = true
      continue
    }
    if (argument === '--tag') {
      assert.equal(tag, undefined, '--tag may only be specified once')
      index += 1
      assert.ok(args[index], '--tag requires a version')
      tag = args[index]
      continue
    }
    assert.fail(`Unknown argument: ${argument}`)
  }

  assert.equal(check, true, 'Specify --check or --print-files')
  return { command: 'check', tag }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2))
  if (parsed.command === 'print-files') {
    console.log(releaseFiles.join('\n'))
    return
  }

  const result = await validateRelease(process.cwd(), parsed.tag)
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
