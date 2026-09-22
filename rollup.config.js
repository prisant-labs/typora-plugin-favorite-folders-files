import fs from 'node:fs/promises'

import { babel } from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'
import typescript from '@rollup/plugin-typescript'
import virtual from '@rollup/plugin-virtual'
import { defineConfig } from 'rollup'
import scss from 'rollup-plugin-scss'
import { typoraPlugin, virtualModules } from 'rollup-plugin-typora'

const { compilerOptions } = JSON.parse(await fs.readFile('./tsconfig.json', 'utf8'))

await fs.rm('./dist', { recursive: true, force: true })
await fs.mkdir('./dist')

function copyReleaseMetadata() {
  return {
    name: 'copy-release-metadata',
    async writeBundle() {
      await Promise.all([
        fs.copyFile('./src/manifest.json', './dist/manifest.json'),
        fs.copyFile('./LICENSE.md', './dist/LICENSE.md'),
        fs.copyFile(
          './THIRD-PARTY-NOTICES.md',
          './dist/THIRD-PARTY-NOTICES.md',
        ),
      ])
    },
  }
}

export default defineConfig({
  input: 'src/main.ts',
  output: {
    file: 'dist/main.js',
    format: 'es',
  },
  plugins: [
    replace({
      preventAssignment: true,
      'process.env.IS_DEV': 'false',
    }),
    virtual(virtualModules),
    typoraPlugin(),
    nodeResolve(),
    commonjs(),
    typescript({
      compilerOptions: {
        ...compilerOptions,
        target: 'ES5',
        module: undefined,
        downlevelIteration: true,
      },
    }),
    babel({
      babelHelpers: 'bundled',
      presets: [['@babel/preset-env', { useBuiltIns: false }]],
      exclude: [/\bcore-js\b/],
    }),
    scss({
      fileName: 'style.css',
      processor: (css) => ({ css: css.replace(/\n+\s*/g, '') }),
    }),
    terser(),
    copyReleaseMetadata(),
  ],
})
