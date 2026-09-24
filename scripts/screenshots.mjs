// Renders the README screenshots from the synthetic visual anchor in a headless
// Chromium browser (Edge or Chrome) over the DevTools protocol. Run after
// `pnpm prototype:build`, then review every image before committing it.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const panelClip = height => `(() => {
  const ribbon = document.querySelector('.ribbon').getBoundingClientRect(), sidebar = document.querySelector('.sidebar').getBoundingClientRect()
  return { x: ribbon.left, y: Math.min(ribbon.top, sidebar.top), width: sidebar.right - ribbon.left, height: Math.min(sidebar.height, ${height}) }
})()`

/** Each shot starts from a fresh load of the preview, then uses its real controls. */
export const screenshots = [
  { name: 'favorites-panel', setup: '', clip: panelClip(560) },
  { name: 'recent', setup: `document.querySelector('[data-key="tab-recent"]').click()`, clip: panelClip(460) },
  { name: 'stacked', setup: `document.querySelector('[data-key="view"]').click(); [...document.querySelectorAll('.qa-view-options label')].find(label => label.textContent === 'Stacked').click()`, clip: panelClip(820) },
  { name: 'manage-groups', setup: `document.querySelector('[data-key="manage"]').click()`, clip: panelClip(480) },
  { name: 'settings', setup: `document.querySelector('[data-key="settings"]').click()`, clip: `(() => { const box = document.querySelector('.typ-setting-tab').getBoundingClientRect(); return { x: box.left, y: box.top, width: box.width, height: box.height } })()` },
]

export function findBrowser({ env, platform, exists }) {
  if (env.SCREENSHOT_BROWSER) return env.SCREENSHOT_BROWSER
  const candidates = {
    win32: [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ],
    darwin: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'],
  }[platform] ?? []
  return candidates.find(candidate => exists(candidate))
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function main() {
  const browser = findBrowser({ env: process.env, platform: process.platform, exists: existsSync })
  if (!browser) throw new Error('No Edge or Chrome found. Set SCREENSHOT_BROWSER to a Chromium-based browser executable.')
  const page = path.join(root, 'docs', 'prototype', 'quick-access.html')
  const output = path.join(root, 'docs', 'images')
  mkdirSync(output, { recursive: true })
  const profile = mkdtempSync(path.join(tmpdir(), 'favorites-screenshots-'))
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' })
  let socket
  try {
    let port
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      try { port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch { await sleep(100) }
    }
    if (!port) throw new Error('The browser did not open a DevTools port.')
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(entry => entry.type === 'page')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let nextId = 0
    const pending = new Map()
    socket.onmessage = event => { const message = JSON.parse(event.data); pending.get(message.id)?.(message); pending.delete(message.id) }
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, message => message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result))
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? expression)
      return result.result.value
    }
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150))))')
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1100, deviceScaleFactor: 2, mobile: false })
    for (const shot of screenshots) {
      await send('Page.navigate', { url: pathToFileURL(page).href })
      for (let attempt = 0; attempt < 50 && !(await evaluate(`document.documentElement.dataset.prototypeReady === 'true'`)); attempt++) await sleep(100)
      if (shot.setup) await evaluate(shot.setup)
      await settle()
      const clip = await evaluate(shot.clip)
      // Capturing beyond the viewport re-lays out the page and shifts the centered settings dialog.
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...clip, scale: 1 } })
      writeFileSync(path.join(output, `${shot.name}.png`), Buffer.from(data, 'base64'))
      console.log(`docs/images/${shot.name}.png`)
    }
    await send('Browser.close').catch(() => {})
  } finally {
    socket?.close()
    child.kill()
    await sleep(500)
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
