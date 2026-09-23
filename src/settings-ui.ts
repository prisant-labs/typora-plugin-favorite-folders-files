import type { FavoritesPreferences, FavoritesState } from './model'
import { icon } from './panel'
import { FavoritesSettingsPreview } from './settings-preview'

export interface SettingsMetadata {
  version?: string
  author?: string
  authorUrl?: string
  /** A GitHub owner/repository pair or HTTPS repository URL. */
  repo?: string
  openFolder?: () => void | Promise<unknown>
}
/** Counts and timing only: Settings never receives snapshot paths. */
export interface RecentSnapshotStatus { available: boolean; loading: boolean; importedAt?: number; error?: string; files: number; folders: number; ordered: boolean }
export interface RecentSnapshotActions {
  importHistory?: () => void | Promise<unknown>
  clearHistory?: () => void
}
export interface SettingsUiOptions extends SettingsMetadata, RecentSnapshotActions { writable?: boolean; recentAvailable?: boolean; recent?: RecentSnapshotStatus }

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

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** Real session snapshot controls. The neighboring preview keeps its own synthetic data. */
function recentControls(recent: RecentSnapshotStatus, actions: RecentSnapshotActions, disposed: () => boolean, pageStatus: HTMLElement): HTMLElement {
  const wrapper = document.createElement('div'); wrapper.className = 'qa-settings__recent'
  const line = document.createElement('p'); line.className = 'qa-settings__recent-status'; line.dataset.recentStatus = ''; line.setAttribute('role', 'status')
  if (recent.loading) line.textContent = 'Importing from Typora…'
  else if (recent.importedAt !== undefined) {
    const loaded = new Date(recent.importedAt), time = document.createElement('time'); time.dateTime = loaded.toISOString(); time.textContent = loaded.toLocaleTimeString()
    line.append('Snapshot loaded ', time, `: ${plural(recent.files, 'file')}, ${plural(recent.folders, 'folder')}. Not live.`)
  } else line.textContent = recent.available ? 'No snapshot imported in this session.' : 'Manual import is available only in supported Windows Typora windows.'
  const buttons = document.createElement('div'); buttons.className = 'qa-settings__recent-actions'
  const button = (label: string, action: string, run: () => unknown) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.dataset.action = action
    const fail = (error: unknown) => { if (!disposed()) { pageStatus.textContent = error instanceof Error ? error.message : 'The Recent snapshot action could not be completed.'; pageStatus.hidden = false } }
    node.addEventListener('click', () => {
      if (disposed() || node.disabled) return
      try { Promise.resolve(run()).catch(fail) } catch (error) { fail(error) }
    })
    buttons.append(node); return node
  }
  const load = button(recent.loading ? 'Importing…' : recent.importedAt !== undefined ? 'Refresh snapshot' : 'Import from Typora', 'history-import', () => actions.importHistory?.())
  load.disabled = !recent.available || recent.loading || !actions.importHistory
  const clear = button('Clear snapshot', 'history-clear', () => actions.clearHistory?.())
  clear.disabled = (recent.importedAt === undefined && !recent.loading) || !actions.clearHistory
  wrapper.append(line, buttons)
  if (recent.error) { const error = document.createElement('p'); error.className = 'qa-settings__help'; error.setAttribute('role', 'alert'); error.textContent = recent.error; wrapper.append(error) }
  return wrapper
}

/** Shared preference controls for the registered Core settings tab and preview. */
export function renderSettings(container: HTMLElement, state: FavoritesState, onPreferencesPatch: (patch: Partial<FavoritesPreferences>) => void | Promise<unknown>, options: SettingsUiOptions = {}): () => void {
  let disposed = false
  const root = document.createElement('section'); root.className = 'qa-settings'
  // Typora themes style bare header/footer elements as application chrome.
  const masthead = document.createElement('div'); masthead.className = 'qa-settings__masthead'
  const top = document.createElement('div'); top.className = 'qa-settings__masthead-top'
  const heading = document.createElement('h2'); heading.textContent = 'Favorites'
  const badge = document.createElement('span'); badge.className = 'qa-settings__release-status'; badge.dataset.releaseStatus = ''; badge.textContent = 'Development build'
  badge.title = 'Local candidate. This page does not check for a published release.'
  top.append(heading, badge)
  const meta = document.createElement('div'); meta.className = 'qa-settings__meta'
  // Each fact owns its separator, so the dot never lands inside a link or a button.
  const fact = (...content: Array<Node | string>) => { const node = document.createElement('span'); node.className = 'qa-settings__fact'; node.append(...content); meta.append(node) }
  const link = (text: string, href: string, kind: string) => {
    const node = document.createElement('a'); node.textContent = text; node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.dataset.link = kind; return node
  }
  if (options.author) { const href = safeLink(options.authorUrl); fact('By ', href ? link(options.author, href, 'author') : options.author) }
  if (options.version) { const value = document.createElement('strong'); value.textContent = options.version; fact('Installed ', value) }
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
  const sections = Object.fromEntries(['Display', 'Ordering', 'Recent'].map(title => {
    const section = document.createElement('section'); section.className = 'qa-settings__section'; section.dataset.settingsSection = title.toLowerCase(); section.setAttribute('aria-label', title)
    const name = document.createElement('h3'); name.textContent = title; section.append(name); controls.append(section); return [title, section]
  }))
  const fields = [
    ['layout', 'Layout', 'Tabs switch collections. Stacked shows both together.', [['tabs', 'Tabs'], ['stacked', 'Stacked']]],
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
      input.disabled = true; status.hidden = true
      const fail = (error: unknown) => {
        if (disposed) return
        input.value = state.preferences[key]
        status.textContent = error instanceof Error ? error.message : 'The setting could not be saved.'
        status.hidden = false
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
  recentHelp.textContent = 'Import from Typora copies Typora\'s Recent list for this session only. Favorites never saves the copy or changes Typora\'s history. Refresh after opening or clearing items in Typora; Clear forgets the copy.'
  sections.Recent.append(recentHelp)
  if (options.recent) sections.Recent.append(recentControls(options.recent, options, () => disposed, status))
  const capability = document.createElement('p'); capability.className = 'qa-settings__help'; capability.dataset.recentCapability = ''
  capability.textContent = options.recentAvailable ? 'Imported snapshot ordering is available until the snapshot is cleared or this session ends.'
    : options.recent?.importedAt !== undefined ? 'This snapshot has no shared file and folder dates, so Recently opened ordering is unavailable.'
      : 'Import a snapshot to enable Recently opened ordering.'
  sections.Recent.append(capability)
  let preview: FavoritesSettingsPreview | undefined = new FavoritesSettingsPreview(state.preferences)
  layout.append(controls, preview.element); root.append(masthead, help, status, layout); container.replaceChildren(root)
  // Core can hide/reopen its modal without calling the tab's onhide/onshow.
  const visibility = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    if (disposed) return
    if (!root.getClientRects().length) { preview?.dispose(); preview = undefined }
    else if (!preview) { preview = new FavoritesSettingsPreview(state.preferences); layout.append(preview.element) }
  })
  visibility?.observe(root)
  return () => { disposed = true; visibility?.disconnect(); preview?.dispose(); root.remove() }
}
