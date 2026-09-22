import fs from 'node:fs/promises'

import * as esbuild from 'esbuild'
import typoraPlugin, { installDevPlugin } from 'esbuild-plugin-typora'
import { sassPlugin } from 'esbuild-sass-plugin'

const arguments_ = new Set(process.argv.slice(2))
const isProduction = arguments_.has('--prod')
const shouldInstall = arguments_.has('--install')

await fs.rm('./dist', { recursive: true, force: true })

await esbuild.build({
  entryPoints: ['src/main.ts'],
  outdir: 'dist',
  format: 'esm',
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction,
  plugins: [
    typoraPlugin({ mode: isProduction ? 'production' : 'development' }),
    sassPlugin(),
  ],
})

if (shouldInstall) {
  await installDevPlugin()
  console.log('Installed the development build into the synthetic test vault.')
}
