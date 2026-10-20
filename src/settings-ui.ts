import { browsePlaces, CHOOSER_FAILED, drivesName, folderName, placeId, rootExample, rootId, splitPlaces, withRoot, type BrowsePlace } from './browse-model'
import type { BrowseRootsChange } from './browse-runtime'
import type { PanelTab } from './browse-store'
import type { FolderChooser } from './folder-chooser'
import type { FavoritesPreferences, FavoritesState, Platform } from './model'
import { icon, TAB_ICONS } from './panel'
import { FavoritesSettingsPreview } from './settings-preview'

export interface SettingsMetadata {
  version?: string
  author?: string
  authorUrl?: string
  /** A GitHub owner/repository pair or HTTPS repository URL. */
  repo?: string
  openFolder?: () => void | Promise<unknown>
}
export interface SettingsUiOptions extends SettingsMetadata {
  writable?: boolean
  recentAvailable?: boolean
  /** A newer Favorites that Core's Marketplace offers; `open` shows the confirmation. */
  update?: { version: string; open(): void }
  /** The automatic update check. Stored apart from the Favorites preferences. */
  updates?: { enabled: boolean; setEnabled(enabled: boolean): void | Promise<unknown> }
  /** The panel's tab order. Saved in Browse's record, apart from the Favorites preferences. `error` is a failed save the host kept across a redraw. */
  tabs?: { order: readonly PanelTab[]; writable: boolean; setOrder(order: PanelTab[]): void | Promise<unknown>; error?: string }
  /** Browse's roots and its Home and Drives rows. Saved in Browse's record, apart from the Favorites preferences. */
  browse?: BrowseSettingsOptions
}
/** The row a Browse message belongs to: the list of roots, or the ways to add one. */
export type BrowseSettingField = 'roots' | 'add'
export type BrowseSettingError = { at: BrowseSettingField; message: string }
export interface BrowseSettingsOptions extends BrowseRootsChange {
  platform: Platform
  /** False until Browse's record has been read. */
  writable: boolean
  /** The folder Typora has open, offered as a root. */
  current?: string
  /** Where Home is, when this Typora window says. */
  homeFolder?: string
  /** The typed path and the last message. The host keeps both, so that a redraw loses neither. */
  input: string
  error?: BrowseSettingError
  setInput(value: string): void
  /** Shows a message in one row, or clears it. The host draws the page again unless `redraw` is false. */
  setError(error?: BrowseSettingError, redraw?: boolean): void
  save(change: BrowseRootsChange): void | Promise<unknown>
  /** Typora's folder chooser. Absent where Typora offers none. */
  choose?: FolderChooser
}
const TAB_NAMES: Record<PanelTab, string> = { favorites: 'Favorites', recent: 'Recent', browse: 'Browse' }
const SAVE_FAILED = 'The setting could not be saved.'

/** A setting's own message, shown in its row rather than at the top of the page. */
function showRowError(row: HTMLElement, message: string) {
  let node = row.querySelector<HTMLElement>(':scope > .qa-settings__error')
  if (!node) { node = document.createElement('span'); node.className = 'qa-settings__error'; node.setAttribute('role', 'alert'); row.append(node) }
  node.textContent = message
}
function clearRowError(row: HTMLElement) { row.querySelector(':scope > .qa-settings__error')?.remove() }

function safeLink(value?: string): string | undefined {
  if (!value) return undefined
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}
function repositoryLink(value?: string): string | undefined {
  if (!value) return undefined
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return `https://github.com/${value}`
  const link = safeLink(value)
  if (!link) return undefined
  const url = new URL(link)
  return url.protocol === 'https:' && url.hostname === 'github.com' && /^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname) ? link : undefined
}

/** The automatic update check: a checkbox that saves through its own store and rolls back on failure. */
function updateSetting(updates: NonNullable<SettingsUiOptions['updates']>, isDisposed: () => boolean): HTMLElement {
  const label = document.createElement('label'); label.className = 'qa-setting-row'
  const text = document.createElement('span'); text.className = 'qa-settings__setting-info'
  const name = document.createElement('span'); name.className = 'qa-settings__setting-name'; name.textContent = 'Check for updates automatically'
  const detail = document.createElement('span'); detail.className = 'qa-settings__setting-description'
  detail.textContent = 'At most once a day, when this page or the Favorites panel opens, Favorites asks Community Plugin Core to check the Plugin Marketplace for a newer version. Core downloads the Marketplace\'s public lists from GitHub. Favorites sends nothing about you or your files.'
  text.append(name, detail)
  const box = document.createElement('input'); box.type = 'checkbox'; box.checked = updates.enabled
  box.dataset.settingKey = 'checkForUpdates'; box.setAttribute('aria-label', 'Check for updates automatically')
  box.addEventListener('change', () => {
    if (isDisposed() || box.disabled) return
    const enabled = box.checked
    box.dataset.restoreFocus = String(document.activeElement === box)
    box.disabled = true; clearRowError(label)
    const fail = (error: unknown) => {
      if (isDisposed()) return
      box.checked = !enabled
      showRowError(label, error instanceof Error ? error.message : SAVE_FAILED)
    }
    const complete = () => {
      if (isDisposed()) return
      box.disabled = false
      if (box.dataset.restoreFocus === 'true' && box.isConnected && document.activeElement === document.body) box.focus()
      delete box.dataset.restoreFocus
    }
    try { Promise.resolve(updates.setEnabled(enabled)).catch(fail).finally(complete) } catch (error) { fail(error); complete() }
  })
  label.append(text, box)
  return label
}

/**
 * The tab order: each tab with Move up and Move down. A move saves the whole order. This list never
 * changes itself: the host draws the page again from Browse's record, which also undoes a failed save.
 */
function tabOrderSetting(tabs: NonNullable<SettingsUiOptions['tabs']>, isDisposed: () => boolean): HTMLElement {
  const row = document.createElement('div'); row.className = 'qa-setting-row'; row.dataset.tabOrder = ''
  row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Tab order')
  const text = document.createElement('span'); text.className = 'qa-settings__setting-info'
  const name = document.createElement('span'); name.className = 'qa-settings__setting-name'; name.textContent = 'Tab order'
  const detail = document.createElement('span'); detail.className = 'qa-settings__setting-description'
  detail.textContent = 'The order of the tabs in the panel, and of the sections in the Stacked layout.'
  text.append(name, detail)
  const list = document.createElement('ol'); list.className = 'qa-settings__order'
  let saving = false
  tabs.order.forEach((tab, index) => {
    const item = document.createElement('li'); item.className = 'qa-settings__order-item'
    const label = document.createElement('span'); label.className = 'qa-settings__order-name'; label.textContent = TAB_NAMES[tab]
    // The same icon as the tab in the panel.
    const mark = icon(TAB_ICONS[tab]); mark.classList.add('qa-settings__order-icon')
    item.append(mark, label)
    for (const [direction, delta] of [['up', -1], ['down', 1]] as const) {
      const action = `Move ${direction}: ${TAB_NAMES[tab]}`
      const move = document.createElement('button'); move.type = 'button'; move.className = 'qa-settings__order-move'
      move.title = action; move.setAttribute('aria-label', action); move.append(icon(direction))
      move.dataset.settingKey = `tabOrder:${tab}:${direction}`
      // A move to the end of the list disables this button; focus then goes to the same tab's other button.
      move.dataset.settingFallback = `tabOrder:${tab}:${direction === 'up' ? 'down' : 'up'}`
      move.disabled = !tabs.writable || index + delta < 0 || index + delta >= tabs.order.length
      move.addEventListener('click', () => {
        if (isDisposed() || move.disabled || saving) return
        const order = [...tabs.order]; [order[index], order[index + delta]] = [order[index + delta], order[index]]
        saving = true; clearRowError(row)
        const fail = (error: unknown) => {
          if (isDisposed()) return
          showRowError(row, error instanceof Error ? error.message : SAVE_FAILED)
        }
        const complete = () => { saving = false }
        try { Promise.resolve(tabs.setOrder(order)).catch(fail).finally(complete) } catch (error) { fail(error); complete() }
      })
      item.append(move)
    }
    list.append(item)
  })
  row.append(text, list)
  if (tabs.error) showRowError(row, tabs.error)
  return row
}

/**
 * Browse's section: one list of the roots, Home and Drives, with Move up and Move down, Remove for a
 * root and Hide or Show for Home and Drives; then a row of ways to add a root. Each change saves at
 * once, like the page's other settings, and the host draws the page again from Browse's record. A
 * message shows in the row it is about, below the controls that caused it.
 */
function browseSettings(section: HTMLElement, b: BrowseSettingsOptions) {
  const { platform } = b
  const places = browsePlaces(b.roots, b.tops), drives = drivesName(platform)
  let busy = false
  const message = (error: unknown) => error instanceof Error ? error.message : SAVE_FAILED
  // `typed` is a path the change adds from the field: it leaves the field now and comes back if the save fails.
  const change = (next: Partial<BrowseRootsChange>, at: BrowseSettingField, typed = '') => {
    if (busy || !b.writable) return
    busy = true
    const full: BrowseRootsChange = { roots: [...b.roots], tops: [...b.tops], home: b.home, drives: b.drives, ...next }
    if (typed) b.setInput('')
    if (b.error) b.setError(undefined)
    const fail = (error: unknown) => { if (typed) b.setInput(typed); b.setError({ at, message: message(error) }) }
    try { Promise.resolve(b.save(full)).catch(fail).finally(() => { busy = false }) } catch (error) { fail(error); busy = false }
  }
  // A new root joins the other roots: Home and Drives keep their places.
  const add = (value: string, typed = '') => {
    const result = withRoot(b.roots, value, platform)
    if ('error' in result) b.setError({ at: 'add', message: result.error })
    else change(splitPlaces(browsePlaces(result.roots, b.tops)), 'add', typed)
  }
  const button = (label: string, key: string, action: () => void, glyph?: string, fallback?: string) => {
    const node = document.createElement('button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label)
    node.dataset.settingKey = key; if (fallback) node.dataset.settingFallback = fallback
    if (glyph) { node.className = 'qa-settings__order-move'; node.append(icon(glyph)) } else { node.className = 'qa-settings__button'; node.textContent = label }
    node.disabled = !b.writable; node.addEventListener('click', () => { if (!node.disabled) action() }); return node
  }
  const settingRow = (at: BrowseSettingField, title: string, description: string) => {
    const row = document.createElement('div'); row.className = 'qa-setting-row qa-settings__browse-row'; row.dataset.browseSetting = at
    row.setAttribute('role', 'group'); row.setAttribute('aria-label', title)
    const text = document.createElement('span'); text.className = 'qa-settings__setting-info'
    const name = document.createElement('span'); name.className = 'qa-settings__setting-name'; name.textContent = title
    const detail = document.createElement('span'); detail.className = 'qa-settings__setting-description'; detail.textContent = description
    text.append(name, detail)
    const controls = document.createElement('div'); controls.className = 'qa-settings__roots'
    row.append(text, controls); section.append(row)
    return controls
  }
  const rowError = (controls: HTMLElement, at: BrowseSettingField) => { if (b.error?.at === at) showRowError(controls, b.error.message) }

  const listed = settingRow('roots', 'Roots', `Browse shows these first, in this order. Home and ${drives} can be hidden, not removed.`)
  const list = document.createElement('ol'); list.className = 'qa-settings__order'
  // Each row's last button: Remove for a root, Hide or Show for Home and Drives.
  const lastKey = (place: BrowsePlace) => place.kind === 'root' ? `browseRoot:${placeId(place, platform)}:remove` : place.kind === 'home' ? 'browseHome' : 'browseDrives'
  places.forEach((place, index) => {
    const id = placeId(place, platform), shown = place.kind === 'root' || b[place.kind]
    const label = place.kind === 'root' ? folderName(place.path) : place.kind === 'home' ? 'Home' : drives
    const where = !shown ? 'Hidden' : place.kind === 'root' ? place.path : place.kind === 'home' ? b.homeFolder ?? 'Not known in this Typora window' : `All ${drives.toLowerCase()}`
    const item = document.createElement('li'); item.className = `qa-settings__order-item${shown ? '' : ' qa-settings__root-hidden'}`
    if (place.kind === 'root') item.title = place.path
    const copy = document.createElement('span'); copy.className = 'qa-settings__root-copy'
    const rootName = document.createElement('span'); rootName.className = 'qa-settings__root-name'; rootName.textContent = label
    const rootPath = document.createElement('span'); rootPath.className = 'qa-settings__root-path'; rootPath.textContent = where
    copy.append(rootName, rootPath); item.append(copy)
    for (const [direction, delta] of [['up', -1], ['down', 1]] as const) {
      // A move to the end of the list disables this button; focus then goes to the same row's other button.
      const move = button(`Move ${direction}: ${label}`, `browseRoot:${id}:${direction}`, () => {
        const next = [...places]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; change(splitPlaces(next), 'roots')
      }, direction, `browseRoot:${id}:${direction === 'up' ? 'down' : 'up'}`)
      move.disabled = move.disabled || index + delta < 0 || index + delta >= places.length; item.append(move)
    }
    // A removed root takes its button with it; focus then goes to the same button on the next row. Home and Drives always remain.
    const neighbor = places[index + 1] ?? places[index - 1]
    if (place.kind === 'root') item.append(button(`Remove root: ${label}`, lastKey(place), () => change(splitPlaces(places.filter((_, position) => position !== index)), 'roots'), 'trash', neighbor && lastKey(neighbor)))
    else { const field = place.kind; item.append(button(`${shown ? 'Hide' : 'Show'} ${label}`, lastKey(place), () => change({ [field]: !shown }, 'roots'), shown ? 'eye' : 'eye-off')) }
    list.append(item)
  })
  listed.append(list)
  rowError(listed, 'roots')

  const adding = settingRow('add', 'Add a root', 'Choose a folder, add the folder Typora has open, or type a full path.')
  const adders = document.createElement('div'); adders.className = 'qa-settings__root-adders'
  if (b.choose) {
    const choose = b.choose
    adders.append(button('Choose folder…', 'browseRootChoose', () => {
      const failed = () => b.setError({ at: 'add', message: CHOOSER_FAILED })
      let chosen: Promise<string | undefined>
      try { chosen = choose(b.current) } catch { failed(); return }
      // A cancelled dialog changes nothing.
      chosen.then(path => { if (path) add(path) }, failed)
    }))
  }
  const current = b.current
  if (current && !b.roots.some(root => rootId(root, platform) === rootId(current, platform))) {
    adders.append(button(`Add current folder: ${folderName(current)}`, 'browseRootCurrent', () => add(current), undefined, 'browseRootPath'))
  }
  if (adders.childElementCount) adding.append(adders)
  const form = document.createElement('div'); form.className = 'qa-settings__root-form'
  const input = document.createElement('input'); input.type = 'text'; input.value = b.input; input.placeholder = rootExample(platform); input.spellcheck = false
  input.setAttribute('aria-label', 'Folder path'); input.dataset.settingKey = 'browseRootPath'; input.disabled = !b.writable
  if (b.error?.at === 'add' && b.input) input.setAttribute('aria-invalid', 'true')
  input.addEventListener('input', () => {
    b.setInput(input.value)
    // Typing clears the message without a redraw, which would drop an IME composition.
    if (b.error?.at === 'add') { b.setError(undefined, false); clearRowError(adding); input.removeAttribute('aria-invalid') }
  })
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); add(input.value, input.value) } })
  form.append(input, button('Add folder', 'browseRootAdd', () => add(input.value, input.value)))
  adding.append(form)
  rowError(adding, 'add')
}
/** Shared preference controls for the registered Core settings tab and preview. */
export function renderSettings(container: HTMLElement, state: FavoritesState, onPreferencesPatch: (patch: Partial<FavoritesPreferences>) => void | Promise<unknown>, options: SettingsUiOptions = {}): () => void {
  let disposed = false
  const root = document.createElement('section'); root.className = 'qa-settings'
  // Typora themes style bare header/footer elements as application chrome.
  const masthead = document.createElement('div'); masthead.className = 'qa-settings__masthead'
  const top = document.createElement('div'); top.className = 'qa-settings__masthead-top'
  const heading = document.createElement('h2'); heading.textContent = 'Favorites'
  const badge = document.createElement('span'); badge.className = 'qa-settings__release-status'; badge.dataset.releaseStatus = ''; badge.textContent = 'Early release'
  badge.title = 'Favorites is an early release. Please report problems on GitHub.'
  top.append(heading, badge)
  const meta = document.createElement('div'); meta.className = 'qa-settings__meta'
  // Each fact owns its separator, so the dot never lands inside a link or a button.
  const fact = (...content: Array<Node | string>) => { const node = document.createElement('span'); node.className = 'qa-settings__fact'; node.append(...content); meta.append(node) }
  const link = (text: string, href: string, kind: string) => {
    const node = document.createElement('a'); node.textContent = text; node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.dataset.link = kind; return node
  }
  if (options.author) { const href = safeLink(options.authorUrl); fact('By ', href ? link(options.author, href, 'author') : options.author) }
  if (options.version) {
    const value = document.createElement('strong'); value.textContent = options.version
    const update = options.update
    if (update) {
      const label = `Update Favorites to ${update.version}`
      const pill = document.createElement('button'); pill.type = 'button'; pill.className = 'qa-settings__update'; pill.dataset.action = 'update'
      pill.title = label; pill.setAttribute('aria-label', label); pill.append(icon('update'), `Update to ${update.version}`)
      pill.addEventListener('click', () => { if (!disposed) update.open() })
      fact('Installed ', value, pill)
    } else fact('Installed ', value)
  }
  const repository = repositoryLink(options.repo); if (repository) fact(link('GitHub', repository, 'github'))
  const status = document.createElement('p'); status.className = 'qa-settings__status'; status.setAttribute('role', 'alert'); status.hidden = true
  if (options.openFolder) {
    const folder = document.createElement('button'); folder.type = 'button'; folder.className = 'qa-settings__folder'; folder.dataset.action = 'open-plugin-folder'; folder.title = 'Open installed plugin folder'
    folder.append(icon('folder'), 'Local folder')
    folder.addEventListener('click', () => {
      if (disposed || folder.disabled) return
      folder.disabled = true; status.hidden = true
      Promise.resolve().then(() => { if (!disposed) return options.openFolder!() }).catch(error => {
        if (!disposed) { status.textContent = error instanceof Error ? error.message : 'The installed plugin folder could not be opened.'; status.hidden = false }
      }).finally(() => { if (!disposed) folder.disabled = false })
    })
    fact(folder)
  }
  masthead.append(top, meta)
  const help = document.createElement('p'); help.className = 'qa-settings__intro'
  help.textContent = 'Keep folders and documents within reach. These preferences are shared with the sidebar controls.'
  const layout = document.createElement('div'); layout.className = 'qa-settings__layout'
  const controls = document.createElement('div'); controls.className = 'qa-settings__controls'
  const sections = Object.fromEntries(['Display', 'Ordering', 'Recent', ...(options.browse ? ['Browse'] : []), ...(options.updates ? ['Updates'] : [])].map(title => {
    const section = document.createElement('section'); section.className = 'qa-settings__section'; section.dataset.settingsSection = title.toLowerCase(); section.setAttribute('aria-label', title)
    const name = document.createElement('h3'); name.textContent = title; section.append(name); controls.append(section); return [title, section]
  }))
  const fields = [
    ['layout', 'Layout', 'Tabs switch collections. Stacked shows them all together.', [['tabs', 'Tabs'], ['stacked', 'Stacked']]],
    ['groupView', 'Group view', 'Expand groups in an outline or select one with a filter.', [['outline', 'Outline'], ['filter', 'Filter']]],
    ['groupSort', 'Group order', 'Custom uses the order saved in Manage groups.', [['custom', 'Custom'], ['az', 'A–Z'], ['recent', 'Recently opened']]],
    ['itemSort', 'Item order', 'Custom uses the order saved with Arrange Favorites.', [['custom', 'Custom'], ['az', 'A–Z'], ['recent', 'Recently opened']]],
  ] as const
  for (const [key, title, description, choices] of fields) {
    const label = document.createElement('label'); label.className = 'qa-setting-row'
    const text = document.createElement('span'); text.className = 'qa-settings__setting-info'
    const name = document.createElement('span'); name.className = 'qa-settings__setting-name'; name.textContent = title
    const detail = document.createElement('span'); detail.className = 'qa-settings__setting-description'; detail.textContent = description; text.append(name, detail)
    const input = document.createElement('select'); input.setAttribute('aria-label', title); input.dataset.settingKey = key
    for (const [value, label] of choices) {
      const option = document.createElement('option'); option.value = value; option.textContent = label
      option.disabled = value === 'recent' && !options.recentAvailable
      input.append(option)
    }
    input.value = state.preferences[key]; input.disabled = options.writable === false
    input.addEventListener('change', () => {
      if (disposed || input.disabled || !input.selectedOptions[0] || input.selectedOptions[0].disabled) { input.value = state.preferences[key]; return }
      // Remember focus before disabling: native selects may immediately blur.
      input.dataset.restoreFocus = String(document.activeElement === input)
      input.disabled = true; clearRowError(label)
      const fail = (error: unknown) => {
        if (disposed) return
        input.value = state.preferences[key]
        showRowError(label, error instanceof Error ? error.message : SAVE_FAILED)
      }
      const complete = () => {
        if (disposed) return
        input.disabled = options.writable === false
        if (input.dataset.restoreFocus === 'true' && !input.disabled && input.isConnected && document.activeElement === document.body) input.focus()
        delete input.dataset.restoreFocus
      }
      try {
        Promise.resolve(onPreferencesPatch({ [key]: input.value })).catch(fail).finally(complete)
      } catch (error) { fail(error); complete() }
    })
    label.append(text, input); sections[key === 'layout' || key === 'groupView' ? 'Display' : 'Ordering'].append(label)
  }
  const recentHelp = document.createElement('p'); recentHelp.className = 'qa-settings__help'
  recentHelp.textContent = 'Recent shows Typora\'s own Recent list (File → Open Recent), read while the Favorites panel is open. Favorites never saves the list or changes it. It is available in Typora for Windows and macOS.'
  const capability = document.createElement('p'); capability.className = 'qa-settings__help'; capability.dataset.recentCapability = ''
  capability.textContent = options.recentAvailable ? 'Recently opened ordering is available: every entry in Typora\'s Recent list has a date.'
    : 'Recently opened ordering needs a date on every entry in Typora\'s Recent list. While it is unavailable, Favorites keeps your Custom order.'
  sections.Recent.append(recentHelp, capability)
  if (options.tabs) sections.Display.append(tabOrderSetting(options.tabs, () => disposed))
  if (options.browse) browseSettings(sections.Browse, options.browse)
  if (options.updates) sections.Updates.append(updateSetting(options.updates, () => disposed))
  let preview: FavoritesSettingsPreview | undefined = new FavoritesSettingsPreview(state.preferences, options.tabs?.order)
  layout.append(controls, preview.element); root.append(masthead, help, status, layout); container.replaceChildren(root)
  // Core can hide/reopen its modal without calling the tab's onhide/onshow.
  const visibility = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    if (disposed) return
    if (!root.getClientRects().length) { preview?.dispose(); preview = undefined }
    else if (!preview) { preview = new FavoritesSettingsPreview(state.preferences, options.tabs?.order); layout.append(preview.element) }
  })
  visibility?.observe(root)
  return () => { disposed = true; visibility?.disconnect(); preview?.dispose(); root.remove() }
}
