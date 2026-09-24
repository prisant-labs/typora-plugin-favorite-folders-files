import fs from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import archiver from 'archiver'

import { releaseFiles } from './scripts/release.mjs'

function parseArguments(args) {
  const options = {
    dist: path.resolve('dist'),
    output: path.resolve('plugin.zip'),
    brandedOutput: path.resolve('plugin_typora-favorite-folders-files.zip'),
  }
  const names = new Map([
    ['--dist', 'dist'],
    ['--output', 'output'],
    ['--branded-output', 'brandedOutput'],
  ])

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    const property = names.get(option)
    if (!property) throw new Error(`Unknown argument: ${option}`)
    index += 1
    if (!args[index]) throw new Error(`${option} requires a path`)
    options[property] = path.resolve(args[index])
  }

  return options
}

async function createArchive({ dist, output, brandedOutput }) {
  // Load every required file before opening an output stream. A missing file
  // therefore fails closed without leaving a plausible partial archive behind.
  const entries = releaseFiles.map(name => ({
    name,
    contents: fs.readFileSync(path.join(dist, name)),
  }))

  await mkdir(path.dirname(output), { recursive: true })
  await mkdir(path.dirname(brandedOutput), { recursive: true })

  const outputStream = fs.createWriteStream(output)
  const archive = archiver('zip', { zlib: { level: 9 } })
  const completed = new Promise((resolve, reject) => {
    outputStream.on('close', resolve)
    outputStream.on('error', reject)
    archive.on('error', reject)
  })

  archive.pipe(outputStream)
  for (const { name, contents } of entries) {
    archive.append(contents, {
      name,
      date: new Date('1980-01-01T00:00:00.000Z'),
      mode: 0o100644,
    })
  }

  await archive.finalize()
  await completed
  await copyFile(output, brandedOutput)
}

try {
  await createArchive(parseArguments(process.argv.slice(2)))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
