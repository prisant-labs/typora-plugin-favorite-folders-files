import type { PreferencesPatch, State } from './model'

/** One editor for the installed settings tab, panel modal, and visual anchor. */
export function renderSettings(container: HTMLElement, state: State, onPreferencesPatch: (patch: PreferencesPatch) => void | Promise<void>): () => void {
  const root = document.createElement('section'); root.className = 'qa-settings'
  const heading = document.createElement('h3'); heading.textContent = 'Quick Access'
  const help = document.createElement('p')
  help.textContent = 'Recent-history collection is not enabled in this development candidate pending the history-source decision. Pins and preferences are stored locally in the Typora browser profile; cross-window and cross-folder sharing awaits native validation.'
  root.append(heading, help)
  const status = document.createElement('p'); status.setAttribute('role', 'alert'); status.hidden = true
  for (const [key, title] of [['recentFiles', 'Recent files'], ['recentFolders', 'Recent folders']] as const) {
    const label = document.createElement('label'); label.className = 'qa-setting-row'
    const text = document.createElement('span'); text.textContent = title
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '1'
    input.value = String(state.preferences[key]); input.setAttribute('aria-label', title)
    input.addEventListener('change', () => {
      if (!input.value || !Number.isFinite(input.valueAsNumber)) { input.value = String(state.preferences[key]); return }
      const count = Math.max(0, Math.min(100, Math.floor(input.valueAsNumber))); input.value = String(count)
      const fail = () => { status.textContent = 'The setting could not be saved.'; status.hidden = false }
      try { Promise.resolve(onPreferencesPatch({ [key]: count })).catch(fail) } catch { fail() }
    })
    label.append(text, input); root.append(label)
  }
  const limits = document.createElement('p'); limits.textContent = 'Choose 0–100 per list. Pinned locations stay visible separately. Up to 100 unpinned locations of each kind are retained locally.'
  root.append(limits, status); container.replaceChildren(root)
  return () => root.remove()
}
