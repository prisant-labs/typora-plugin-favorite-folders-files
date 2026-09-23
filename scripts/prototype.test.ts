import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { renderPrototype } from './prototype.mjs'

const root = resolve(import.meta.dirname, '..')
const generator = resolve(root, 'scripts/prototype.mjs')
describe('CI visual anchor', () => {
  it('invalidates the fingerprint for production changes outside the preview entrypoint', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'quick-access-source-'))
    try {
      for (const source of ['src', 'prototype']) cpSync(resolve(root, source), join(directory, source), { recursive: true })
      mkdirSync(join(directory, 'scripts'))
      for (const file of ['LICENSE.md', 'package.json', 'pnpm-lock.yaml', 'scripts/prototype.mjs']) cpSync(resolve(root, file), join(directory, file))
      const before = await renderPrototype(directory)
      const source = join(directory, 'src/storage.ts')
      writeFileSync(source, readFileSync(source, 'utf8') + '\n// Deliberate source-only drift fixture.\n')
      const after = await renderPrototype(directory)
      expect(before.match(/name="source-fingerprint" content="([^"]+)/)?.[1]).not.toBe(after.match(/name="source-fingerprint" content="([^"]+)/)?.[1])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 20000) // Two complete bundles plus cold Sass startup, like the build test below.
  it('regenerates deterministically and rejects missing or changed committed output without rewriting it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'quick-access-anchor-'))
    const output = join(directory, 'preview.html')
    const run = (...args: string[]) => spawnSync(process.execPath, [generator, '--output', output, ...args], { cwd: root, encoding: 'utf8' })
    try {
      expect(run('--check').status).toBe(1)
      expect(run().status).toBe(0)
      const html = readFileSync(output, 'utf8')
      expect(run('--check').status).toBe(0)
      expect(run().status).toBe(0)
      expect(readFileSync(output, 'utf8')).toBe(html)
      writeFileSync(output, html.replace('Your folders and files', 'Stale folders and files'))
      expect(run('--check').status).toBe(1)
      expect(readFileSync(output, 'utf8')).toContain('Stale folders and files')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 20000)
  it('runs offline with actual production Favorites interactions and no external assets', async () => {
    const html = readFileSync(resolve(root, 'docs/prototype/quick-access.html'), 'utf8')
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=["'](?:https?:|\/\/)/i)
    expect(html).not.toMatch(/url\((?!data:)/)
    expect(html).toMatch(/name="source-fingerprint" content="[a-f0-9]{64}"/)
    expect(html).toContain("connect-src 'none'")
    const errors: Error[] = []
    const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error))
    const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole })
    try {
      const doc = dom.window.document
      expect(errors).toEqual([])
      expect(doc.documentElement.dataset.prototypeReady).toBe('true')
      expect(doc.querySelectorAll('.qa-row')).toHaveLength(5)
      doc.querySelector<HTMLButtonElement>('[data-key=tab-recent]')!.click()
      await Promise.resolve()
      expect(doc.querySelectorAll('.qa-row')).toHaveLength(0)
      expect(doc.querySelector('#ribbon-quick-access svg')?.getAttribute('width')).toBe('24')
      // Host shell mirrors Core's settings wrappers so the preview's pane-height stretch is reviewable.
      expect(doc.querySelector('.typ-modal__body > .typ-main > .typ-setting-tab > #settings-mount.qa-settings-host')).not.toBeNull()
      doc.querySelector<HTMLButtonElement>('[data-key=history-import]')!.click()
      await Promise.resolve()
      expect(doc.querySelectorAll('.qa-row').length).toBeGreaterThan(0)
      const search = doc.querySelector<HTMLInputElement>('[data-key=search]')!
      search.value = 'Projects'; search.dispatchEvent(new dom.window.Event('input'))
      expect(doc.querySelectorAll('.qa-row')).toHaveLength(2)
      expect(doc.querySelectorAll('.quick-access')).toHaveLength(1)
      doc.querySelector<HTMLButtonElement>('[data-key=add]')!.click()
      expect(doc.querySelector('.qa-editor')).not.toBeNull()
      expect(doc.querySelector('[data-key=editor-save]')).not.toBeNull()
      doc.querySelector<HTMLButtonElement>('#reset')!.click()
      expect(doc.querySelector('.qa-editor')).toBeNull()
      expect(doc.querySelector<HTMLInputElement>('[data-key=search]')!.value).toBe('')
    } finally { dom.window.close() }
  })
})
