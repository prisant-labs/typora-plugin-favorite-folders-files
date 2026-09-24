import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { compile } from 'sass'

const root = fileURLToPath(new URL('../', import.meta.url))
const normalize = value => value.replace(/\r\n?/g, '\n')
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
async function sources(directory, sourceRoot) {
  const entries = await readdir(path.join(sourceRoot, directory), { withFileTypes: true })
  const files = await Promise.all(entries.map(entry => {
    const name = directory + '/' + entry.name
    return entry.isDirectory() ? sources(name, sourceRoot) : /\.(ts|scss|html|json)$/.test(name) && !name.endsWith('.test.ts') ? [name] : []
  }))
  return files.flat().sort()
}
export async function renderPrototype(sourceRoot = root) {
  const read = async name => normalize(await readFile(path.join(sourceRoot, name), 'utf8'))
  const manifest = JSON.parse(await read('src/manifest.json'))
  const files = [...await sources('src', sourceRoot), ...await sources('prototype', sourceRoot), 'LICENSE.md', 'scripts/prototype.mjs', 'package.json', 'pnpm-lock.yaml'].sort()
  const hash = createHash('sha256')
  for (const file of files) hash.update(file + '\0' + await read(file) + '\0')
  const bundled = await build({
    absWorkingDir: sourceRoot, entryPoints: ['prototype/main.ts'], bundle: true,
    write: false, format: 'iife', platform: 'browser', target: 'es2020',
    minify: true, charset: 'ascii', legalComments: 'none',
  })
  const css = ['prototype/shell.scss', 'src/style.scss', 'src/settings.scss'].map(file => compile(path.join(sourceRoot, file), { style: 'compressed' }).css).join('\n')
  const values = {
    VERSION: escapeHtml(manifest.version), FINGERPRINT: hash.digest('hex'),
    LICENSE: escapeHtml(await read('LICENSE.md')),
    CSS: normalize(css).replace(/<\/style/gi, '<\\/style'),
    JS: normalize(bundled.outputFiles[0].text).replace(/<\/script/gi, '<\\/script'),
  }
  return (await read('prototype/shell.html')).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error('Unknown prototype placeholder: ' + key)
    return values[key]
  })
}
async function main() {
  const args = process.argv.slice(2)
  let check = false
  let output = path.join(root, 'docs/prototype/quick-access.html')
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') check = true
    else if (args[index] === '--output' && args[index + 1]) output = path.resolve(args[++index])
    else throw new Error('Usage: node scripts/prototype.mjs [--check] [--output path]')
  }
  const html = await renderPrototype()
  if (check) {
    const existing = await readFile(output, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
    if (normalize(existing) !== html) throw new Error('Quick Access visual anchor is missing or stale. Run pnpm prototype:build and include docs/prototype/quick-access.html.')
    console.log('Quick Access visual anchor is current.')
  } else {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, html, 'utf8')
    console.log('Generated self-contained visual anchor: ' + output)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
