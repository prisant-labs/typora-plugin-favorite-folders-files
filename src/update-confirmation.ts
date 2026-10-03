export interface UpdateConfirmationOptions {
  installed: string
  version: string
  /** A GitHub owner/repository pair, for the release link. */
  repo?: string
  /** Starts the update. It settles only if Core did not unload Favorites, so nothing was installed. */
  confirm(): Promise<unknown>
  close(): void
  isOpen(): boolean
  /** Opens an external link through the host; Core's dialog is outside the areas where Core routes links. */
  openLink?(href: string): void
}

const NOT_UPDATED = 'Favorites was not updated. You can update it from Installed Plugins in Community Plugin options.'

function text<K extends keyof HTMLElementTagNameMap>(tag: K, content: string, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = content
  if (className) node.className = className
  return node
}

/** The update confirmation's body: what will happen, a release link, and Update / Cancel. No Core dependency. */
export function buildUpdateConfirmation(options: UpdateConfirmationOptions): HTMLElement {
  const root = document.createElement('div'); root.className = 'qa-update-confirmation'
  const question = document.createElement('p'); question.className = 'qa-update-confirmation__question'
  const from = text('strong', options.installed), to = text('strong', options.version)
  question.append('Update Favorites from ', from, ' to ', to, '?')
  const facts = document.createElement('ul')
  facts.append(
    text('li', 'Community Plugin Core downloads the newest release from GitHub and reloads Favorites in this window.'),
    text('li', 'Your saved Favorites are kept.'),
    text('li', `Other Typora windows keep ${options.installed} until you restart them.`),
    text('li', 'If the download fails, reinstall Favorites from the Plugin Marketplace. Your saved Favorites are still kept.'),
  )
  root.append(question, facts)
  if (options.repo && /^[\w.-]+\/[\w.-]+$/.test(options.repo)) {
    const link = text('a', `What's new in ${options.version}`, 'qa-update-confirmation__release')
    link.href = `https://github.com/${options.repo}/releases/tag/${encodeURIComponent(options.version)}`
    link.target = '_blank'; link.rel = 'noopener noreferrer'
    const openLink = options.openLink
    if (openLink) link.addEventListener('click', event => { event.preventDefault(); openLink(link.href) })
    const line = document.createElement('p'); line.append(link); root.append(line)
  }
  const status = text('p', '', 'qa-update-confirmation__status'); status.setAttribute('role', 'status'); status.hidden = true
  const actions = document.createElement('div'); actions.className = 'qa-update-confirmation__actions'
  const update = text('button', 'Update', 'primary'); update.type = 'button'; update.dataset.action = 'confirm-update'
  const cancel = text('button', 'Cancel'); cancel.type = 'button'; cancel.dataset.action = 'cancel-update'
  cancel.addEventListener('click', () => options.close())
  update.addEventListener('click', () => {
    if (update.disabled) return
    update.disabled = cancel.disabled = true
    status.textContent = 'Updating Favorites…'; status.hidden = false
    const notUpdated = () => {
      if (!options.isOpen()) return
      status.textContent = NOT_UPDATED
      update.remove(); cancel.textContent = 'Close'; cancel.disabled = false
    }
    let started: Promise<unknown>
    try { started = Promise.resolve(options.confirm()) } catch (error) { started = Promise.reject(error) }
    started.then(notUpdated, notUpdated)
  })
  actions.append(update, cancel)
  root.append(status, actions)
  return root
}
