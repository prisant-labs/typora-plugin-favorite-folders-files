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
export interface SettingsUiOptions extends SettingsMetadata { writable?: boolean; recentAvailable?: boolean }

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

/** Shared preference controls for the registered Core settings tab and preview. */
export function renderSettings(container: HTMLElement, state: FavoritesState, onPreferencesPatch: (patch: Partial<FavoritesPreferences>) => void | Promise<unknown>, options: SettingsUiOptions = {}): () => void {
  let disposed = false
  const root = document.createElement('section'); root.className = 'qa-settings'
  // Typora themes style bare header/footer elements as application chrome.
  const masthead = document.createElement('div'); masthead.className = 'qa-settings__masthead'
  const top = document.createElement('div'); top.className = 'qa-settings__masthead-top'
  const heading = document.createElement('h2'); heading.textContent = 'Favorites'
  const badge = document.createElement('span'); badge.className = 'qa-settings__release-status'; badge.dataset.releaseStatus = ''; badge.textContent = 'Early release'
  badge.title = 'Favorites is an early release. This page does not check for updates; please report problems on GitHub.'
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
  recentHelp.textContent = 'Recent shows Typora\'s own Recent list (File → Open Recent), read while the Favorites panel is open. Favorites never saves the list or changes it. It is currently available in Typora for Windows.'
  const capability = document.createElement('p'); capability.className = 'qa-settings__help'; capability.dataset.recentCapability = ''
  capability.textContent = options.recentAvailable ? 'Recently opened ordering is available: every entry in Typora\'s Recent list has a date.'
    : 'Recently opened ordering needs a date on every entry in Typora\'s Recent list. Until then, Favorites keeps your Custom order.'
  sections.Recent.append(recentHelp, capability)
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
