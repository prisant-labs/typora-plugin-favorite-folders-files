import { FavoritesPanelRenderer } from './favorites-panel'
import { applyFavoritesOperation, createFavoritesState, UNGROUPED_GROUP_ID, type FavoritesPreferences, type FavoritesState } from './model'
import { replayFavoritesDraft } from './editor-state'
import { normalizeHistory } from './native-history'

/** An in-memory sample: no real favorites, persisted changes, or native actions. */
export class FavoritesSettingsPreview {
  readonly element = document.createElement('aside')
  private readonly panel = document.createElement('div')
  private readonly status = document.createElement('p')
  private readonly renderer: FavoritesPanelRenderer
  private state: FavoritesState = createFavoritesState()
  private disposed = false

  constructor(preferences: FavoritesPreferences) {
    this.element.className = 'qa-settings__preview'
    this.element.setAttribute('aria-label', 'Synthetic Favorites preview')
    const heading = document.createElement('h3'); heading.textContent = 'Live preview'
    const help = document.createElement('p'); help.className = 'qa-settings__help'
    help.textContent = 'Synthetic data. Preview controls do not change your saved preferences or open real locations.'
    this.panel.className = 'qa-settings__preview-panel'
    this.status.className = 'qa-settings__preview-status'; this.status.setAttribute('role', 'status'); this.status.hidden = true
    this.element.append(heading, help, this.panel, this.status)
    const apply = (operation: Parameters<typeof applyFavoritesOperation>[1]) => { this.state = applyFavoritesOperation(this.state, operation, 'win32') }
    apply({ type: 'group:create', id: 'sample-projects', name: 'Projects' })
    apply({ type: 'group:create', id: 'sample-writing', name: 'Writing' })
    apply({ type: 'favorite:add', kind: 'folder', path: 'C:/Example/Projects/Atlas', groupId: 'sample-projects' })
    apply({ type: 'favorite:add', kind: 'file', path: 'C:/Example/Projects/Atlas/Project brief.md', groupId: 'sample-projects' })
    apply({ type: 'favorite:add', kind: 'file', path: 'C:/Example/Writing/Weekend essay.md', groupId: 'sample-writing' })
    apply({ type: 'favorite:add', kind: 'folder', path: 'C:/Example/Notes/Inbox', groupId: UNGROUPED_GROUP_ID })
    // Only appearance/order settings cross the boundary, never real group IDs.
    const { layout, groupView, groupSort, itemSort } = preferences
    apply({ type: 'favorites:preferences', patch: { layout, groupView, groupSort, itemSort } })
    this.renderer = new FavoritesPanelRenderer(this.panel, {
      change: operation => { if (!this.disposed) { apply(operation); this.render() } },
      commit: async draft => {
        if (this.disposed) throw new Error('The preview is closed.')
        this.state = replayFavoritesDraft(this.state, draft, 'win32'); this.render(); return this.state
      },
      open: () => this.explain('Preview only. No document or folder was opened.'),
      reveal: () => this.explain('Preview only. No file manager was opened.'),
      settings: () => this.explain('Preview only. Use the settings alongside this panel.'),
    })
    this.render()
  }

  private explain(message: string) { if (!this.disposed) { this.status.textContent = message; this.status.hidden = false } }
  private render() {
    if (this.disposed) return
    this.renderer.update({ state: this.state, platform: 'win32', writable: true, current: { file: 'C:/Example/Notes/Ideas.md', folder: 'C:/Example/Notes' }, history: normalizeHistory({
      status: 'ready', order: 'global', entries: [
        { kind: 'file', path: 'C:/Example/Notes/Ideas.md' },
        { kind: 'folder', path: 'C:/Example/Notes' },
        { kind: 'file', path: 'C:/Example/Projects/Atlas/Project brief.md' },
      ],
    }, 'win32') })
  }
  dispose() { this.disposed = true; this.renderer.dispose(); this.element.remove() }
}
