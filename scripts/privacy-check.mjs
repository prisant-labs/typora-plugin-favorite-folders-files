#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { TextDecoder } from 'node:util'

const sensitiveTextPatterns = [
  {
    label: 'Windows user home path',
    pattern: /(?:[A-Za-z]:|\\\\[^\\/\s]+)[\\/]+Users[\\/]+[^\\/\s"']+[\\/]/i,
  },
  {
    label: 'macOS user home path',
    pattern: /\/Users\/[^/\s"']+\//,
  },
  {
    label: 'URL containing credentials',
    pattern: /\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@/i,
  },
  {
    label: 'private key material',
    pattern: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/,
  },
  {
    label: 'GitHub access token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    label: 'OpenAI API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    label: 'AWS access key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    label: 'Slack access token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
]

function usageError(message) {
  throw new Error(`${message}\nUsage: privacy-check.mjs --staged [--repo <path>]`)
}

function parseArguments(arguments_) {
  let repo = '.'
  let staged = false

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]

    if (argument === '--staged') {
      staged = true
      continue
    }

    if (argument === '--repo') {
      const value = arguments_[index + 1]
      if (!value || value.startsWith('--')) {
        usageError('--repo requires a path')
      }
      repo = value
      index += 1
      continue
    }

    usageError(`Unknown argument: ${argument}`)
  }

  if (!staged) {
    usageError('Only staged-tree checks are supported; pass --staged')
  }

  return { repo: resolve(repo) }
}

function runGit(repo, arguments_, options = {}) {
  const encoding = Object.hasOwn(options, 'encoding')
    ? options.encoding
    : 'utf8'
  const result = spawnSync('git', ['-C', repo, ...arguments_], {
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })

  if (result.error) {
    throw new Error(`Could not run git: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : result.stderr.trim()
    throw new Error(detail || `git ${arguments_[0]} failed`)
  }

  return result.stdout
}

function stagedPaths(repo) {
  const output = runGit(
    repo,
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { encoding: null },
  )

  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
}

function stagedBlob(repo, path) {
  return runGit(repo, ['show', `:${path}`], { encoding: null })
}

function inspectPath(path, contents) {
  const findings = []

  if (/(?:^|\/)_local(?:\/|$)/i.test(path)) {
    findings.push('private _local path')
    return findings
  }

  if (contents.includes(0)) {
    findings.push('binary content containing NUL bytes cannot be inspected safely')
    return findings
  }

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(contents)
  } catch {
    findings.push('content is not valid UTF-8 and cannot be inspected safely')
    return findings
  }

  for (const { label, pattern } of sensitiveTextPatterns) {
    if (pattern.test(text)) {
      findings.push(label)
    }
  }

  return findings
}

function main() {
  const { repo } = parseArguments(process.argv.slice(2))
  const tree = runGit(repo, ['write-tree']).trim()
  const paths = stagedPaths(repo)
  const findings = []

  for (const path of paths) {
    let contents
    try {
      contents = stagedBlob(repo, path)
    } catch (error) {
      findings.push({ path, reasons: [`could not inspect staged blob: ${error.message}`] })
      continue
    }

    const reasons = inspectPath(path, contents)
    if (reasons.length > 0) {
      findings.push({ path, reasons })
    }
  }

  console.log(`Tree: ${tree}`)
  console.log(`Scanned paths: ${paths.length}`)

  if (findings.length > 0) {
    console.log('Result: fail')
    for (const { path, reasons } of findings) {
      console.error(`${path}: ${reasons.join('; ')}`)
    }
    process.exitCode = 1
    return
  }

  console.log('Result: pass')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
