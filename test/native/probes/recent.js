// Favorites: Recent capability probe. Paste this whole file into Typora's DevTools console.
// It reads Typora's Recent channels on Windows or macOS, twice on macOS, and shows one
// plain-text report in the console and in a window with a Copy button. The report holds
// counts, kinds, key names, date types and timings: never paths or names. Hide the
// Favorites panel first, so that its own Recent reads do not overlap the probe.
void (async () => {
  const host = globalThis, WAIT = 5000, GRACE = 250, TIMEOUT = Symbol('timeout')
  if (host.favoritesRecentProbe) { console.log('Favorites Recent probe is already running. Wait for its report.'); return }
  host.favoritesRecentProbe = true
  const lines = [], problems = []
  let passNote = ''
  const say = text => { lines.push(text) }
  const pathKind = value => /^file:/i.test(value) ? 'file URL' : /^(\/|[A-Za-z]:[\\/]|[\\/]{2})/.test(value) ? 'absolute path' : 'other text'
  const kind = value => typeof value === 'string' ? pathKind(value)
    : Array.isArray(value) ? 'list'
      : value && typeof value === 'object' ? `{${Object.keys(value).sort().join(' ')}}` : String(value === null ? 'null' : typeof value)
  const kinds = list => [...new Set(list.map(kind))].join(', ') || 'none'
  const shape = value => Array.isArray(value) ? `${value.length} item(s), kinds: ${kinds(value)}` : `not a list (${kind(value)})`
  const dateTypes = rows => Array.isArray(rows)
    ? [...new Set(rows.map(row => row && typeof row === 'object' && row.date !== undefined ? Object.prototype.toString.call(row.date).slice(8, -1) : 'none'))].join(', ') || 'none'
    : 'n/a'
  const pinned = rows => Array.isArray(rows) ? rows.map((row, index) => row && row.pinned ? index + 1 : 0).filter(Boolean).join(', ') || 'none' : 'n/a'
  const wait = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(TIMEOUT), ms))])
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const typora = host.File || {}

  say('Favorites Recent probe')
  say(`Typora: isMac=${Boolean(typora.isMac)}, isWK=${Boolean(typora.isWK)}, isNode=${Boolean(typora.isNode)}, isMacNode=${Boolean(typora.isMacNode)}`)
  say(`Bridges: bridge.callHandler=${typeof (host.bridge && host.bridge.callHandler)}, JSBridge.invoke=${typeof (host.JSBridge && host.JSBridge.invoke)}`)
  try {
    if (typora.isNode) await windowsGetter()
    else if (typora.isMac) await macChannels()
    else problems.push('Typora reports neither its Electron build nor its macOS build.')
  } catch (error) {
    // The name only: a message could contain a path.
    problems.push(`The probe stopped with ${(error && error.name) || 'an error'}.`)
  } finally {
    delete host.favoritesRecentProbe
  }
  say('')
  if (problems.length) { say('RESULT: FAIL'); for (const problem of problems) say(`- ${problem}`) }
  else say(`RESULT: PASS. ${passNote}`)
  show(lines.join('\n'))

  /** Typora's Electron builds (Windows): one read-only getter returns both lists. */
  async function windowsGetter() {
    const started = Date.now()
    const raw = await wait(Promise.resolve(host.JSBridge.invoke('setting.getRecentFiles')), WAIT)
    if (raw === TIMEOUT) { say(`setting.getRecentFiles: no answer after ${WAIT / 1000} s`); problems.push('The Windows getter did not answer.'); return }
    say(`setting.getRecentFiles answered after ${Date.now() - started} ms`)
    for (const key of ['files', 'folders']) {
      const rows = raw && raw[key]
      say(`  ${key}: ${shape(rows)}; date types: ${dateTypes(rows)}`)
      if (Array.isArray(rows)) say(`  ${key} paths: ${kinds(rows.map(row => row && row.path))}`)
      else problems.push(`The getter's ${key} is not a list.`)
    }
    passNote = 'The Windows getter answered with files and folders lists.'
  }

  /** Typora's macOS build: folders from the folder menu's call, files through Quick Open. */
  async function macChannels() {
    const panel = typora.editor && typora.editor.quickOpenPanel, bridge = host.bridge
    if (!panel || !bridge || typeof bridge.callHandler !== 'function') { problems.push('Typora\'s macOS bridge or Quick Open panel is missing.'); return }
    const names = ['setRecentFiles', 'initFileCache', 'updateCache'].filter(name => typeof panel[name] === 'function')
    say(`Quick Open methods: ${names.join(', ') || 'none'}`)
    const own = names.filter(name => Object.prototype.hasOwnProperty.call(panel, name))
    if (own.length) say(`Quick Open already hooked (another plugin or a Favorites build): ${own.join(', ')}`)
    let listener = () => {}
    const hooks = names.map(name => {
      const had = Object.prototype.hasOwnProperty.call(panel, name), prior = panel[name]
      const probe = function (...args) {
        try { listener(name, args) } catch (error) { /* Never disturb Quick Open. */ }
        return prior.apply(this, args)
      }
      panel[name] = probe
      return { name, had, prior, probe }
    })
    const passes = []
    try {
      for (const number of [1, 2]) passes.push(await pass(number))
    } finally {
      listener = () => {}
      const kept = []
      for (const hook of hooks) {
        if (panel[hook.name] !== hook.probe) { kept.push(hook.name); continue }
        if (hook.had) panel[hook.name] = hook.prior
        else delete panel[hook.name]
      }
      if (kept.length) problems.push(`Something else wrapped ${kept.join(', ')} during the probe. Reload the window.`)
    }
    for (const result of passes) {
      if (!result.files) {
        problems.push(result.number === 2 && passes[0].files
          ? 'Pass 2 returned no full Recent files list, so Recent would work only once.'
          : `Pass ${result.number} returned no full Recent files list.`)
      } else if (!Array.isArray(result.files)) problems.push(`Pass ${result.number}'s Recent files are not a list.`)
      else if (result.files.some(path => typeof path !== 'string' || pathKind(path) !== 'absolute path')) {
        problems.push(`Pass ${result.number} has Recent files that are not absolute paths (${kinds(result.files)}).`)
      }
      if (!result.foldersAnswered) problems.push(`Pass ${result.number}: library.getRecentFolders did not answer.`)
      else if (!Array.isArray(result.folders)) problems.push(`Pass ${result.number}: library.getRecentFolders did not return a list.`)
    }
    passNote = 'Both requests returned a full Recent files list of absolute paths, and the folders call answered both times.'

    async function pass(number) {
      say('')
      say(`Pass ${number}`)
      const started = Date.now(), at = () => `${Date.now() - started} ms`
      const result = { number, files: undefined, folders: undefined, foldersAnswered: false }
      let filesArrived, foldersArrived
      const files = new Promise(resolve => { filesArrived = resolve })
      const folders = new Promise(resolve => { foldersArrived = resolve })
      let folderTime = ''
      listener = (name, args) => {
        if (name === 'setRecentFiles') {
          say(`  setRecentFiles at ${at()}: ${shape(args[0])}`)
          if (result.files === undefined) result.files = args[0]
          filesArrived()
        } else if (name === 'initFileCache') {
          say(`  initFileCache at ${at()}: indexed ${Array.isArray(args[0]) ? args[0].length : 'unknown'} document(s); Recent files: ${args[4] ? shape(args[4]) : 'none'}`)
          if (args[4]) { if (result.files === undefined) result.files = args[4]; filesArrived() }
        } else {
          say(`  updateCache at ${at()}: removed ${kind(args[0])}, added ${kind(args[1])}, group ${typeof args[2] === 'string' ? args[2] : kind(args[2])}`)
        }
      }
      bridge.callHandler('library.getRecentFolders', rows => {
        if (result.foldersAnswered) return
        result.foldersAnswered = true; result.folders = rows; folderTime = at(); foldersArrived()
      })
      bridge.callHandler('quickOpen.cacheRecentFiles')
      // Wait for both lists, then briefly for any follow-up edits Typora sends.
      if (await wait(Promise.all([files, folders]), WAIT) !== TIMEOUT) await sleep(GRACE)
      listener = () => {}
      if (result.files === undefined) say(`  No full Recent files list within ${WAIT / 1000} s`)
      if (result.foldersAnswered) {
        const rows = result.folders
        say(`  library.getRecentFolders answered at ${folderTime}: ${shape(rows)}; date types: ${dateTypes(rows)}; pinned at positions: ${pinned(rows)}`)
        if (Array.isArray(rows)) say(`  folder paths: ${kinds(rows.map(row => row && row.path))}`)
      } else say(`  library.getRecentFolders: no answer after ${WAIT / 1000} s`)
      return result
    }
  }

  /** Prints the report once as plain text, and shows it in a window to copy from. */
  function show(text) {
    console.log(text)
    try {
      const previous = document.querySelector('[data-favorites-probe]')
      if (previous) previous.remove()
      const box = document.createElement('div')
      box.dataset.favoritesProbe = ''
      box.style.cssText = 'position:fixed;top:8%;left:8%;right:8%;z-index:2147483647;background:#fff;color:#111;border:1px solid #888;border-radius:8px;padding:12px;box-shadow:0 8px 32px rgba(0,0,0,.35);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
      const title = document.createElement('div')
      title.textContent = 'Favorites Recent probe. The report holds no paths or names.'
      title.style.cssText = 'font-weight:600;margin-bottom:8px'
      const area = document.createElement('textarea')
      area.readOnly = true; area.value = text
      area.style.cssText = 'display:block;width:100%;height:55vh;box-sizing:border-box;background:#fff;color:#111;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace'
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;gap:8px;margin-top:8px'
      const copy = document.createElement('button'), close = document.createElement('button')
      copy.type = 'button'; copy.textContent = 'Copy report'
      close.type = 'button'; close.textContent = 'Close'
      copy.addEventListener('click', () => {
        area.focus(); area.select()
        let copied = false
        try { copied = document.execCommand('copy') } catch (error) { copied = false }
        copy.textContent = copied ? 'Copied' : 'Press Cmd+C or Ctrl+C to copy'
      })
      close.addEventListener('click', () => box.remove())
      row.append(copy, close); box.append(title, area, row); document.body.append(box)
      area.focus(); area.select()
    } catch (error) { /* The console copy above is enough. */ }
  }
})()
