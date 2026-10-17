import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('release stylesheet', () => {
  // rollup-plugin-scss joins separately imported stylesheets in whichever order they finish
  // compiling. With one Sass entry, style.css comes out the same on every build.
  it('builds style.css from one Sass entry that loads the panel styles before the settings styles', () => {
    const imports = [...read('src/main.ts').matchAll(/^import '\.\/([\w-]+\.s?css)'$/gm)].map(match => match[1])
    expect(imports).toEqual(['plugin.scss'])
    expect(read('src/plugin.scss')).toMatch(/^@use 'style';\r?\n@use 'settings';\r?\n?$/m)
  })
})
