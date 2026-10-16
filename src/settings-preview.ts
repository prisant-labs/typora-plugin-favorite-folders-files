import type { BrowseEntry } from './browse-fs'
import { browseKey, browseRows, browseTops, DRIVES_KEY, folderName, type BrowseFolders } from './browse-model'
import type { BrowseSnapshot } from './browse-runtime'
import { cloneBrowseRecord, normalizeBrowseRecord, PANEL_TABS, type BrowseRecord, type PanelTab } from './browse-store'
import { FavoritesPanelRenderer, type BrowsePanelActions } from './favorites-panel'
import { applyFavoritesOperation, createFavoritesState, locationId, UNGROUPED_GROUP_ID, type FavoritesPreferences, type FavoritesState } from './model'
import { replayFavoritesDraft } from './editor-state'
import { normalizeHistory } from './native-history'

// Synthetic folders for the preview's Browse. A trailing slash marks a folder.
const SAMPLE_FOLDERS: Record<string, string[]> = {
  'C:/': ['Example/'],
  'C:/Example': ['Home/', 'Notes/', 'Projects/', 'Writing/'],
  'C:/Example/Projects': ['Atlas/', 'Beacon/', 'Roadmap.md'],
  'C:/Example/Projects/Atlas': ['Project brief.md', 'Timeline.md'],
  'C:/Example/Projects/Beacon': ['Launch plan.md'],
  'C:/Example/Home': ['Documents/', 'Notes/'],
  'C:/Example/Home/Documents': ['Ideas.md'],
  'C:/Example/Home/Notes': ['Inbox.md'],
  'D:/': ['Archive/'],
  'D:/Archive': ['Index.md'],
}
const SAMPLE_HOME = 'C:/Example/Home'
function sampleEntries(folder: string): BrowseEntry[] {
  const base = folder.endsWith('/') ? folder : `${folder}/`
  return (SAMPLE_FOLDERS[folder] ?? []).map(name => name.endsWith('/')
    ? { kind: 'folder', name: name.slice(0, -1), path: base + name.slice(0, -1) }
    : { kind: 'file', name, path: base + name })
}

/** An in-memory sample: no real favorites, persisted changes, or native actions. */
export class FavoritesSettingsPreview {
  readonly element = document.createElement('aside')
  private readonly panel = document.createElement('div')
  private readonly status = document.createElement('p')
  private readonly renderer: FavoritesPanelRenderer
  private state: FavoritesState = createFavoritesState()
  private browse: BrowseRecord
  private readonly folders: BrowseFolders = {}
  private disposed = false

  constructor(preferences: FavoritesPreferences, order: readonly PanelTab[] = PANEL_TABS) {
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
    // Browse's sample keeps the real tab order and nothing else: no real roots or folders.
    this.browse = normalizeBrowseRecord({ roots: ['C:/Example/Projects'], expanded: [browseKey('C:/Example/Projects', 'win32')], order }, 'win32')
    const keep = (change: (record: BrowseRecord) => BrowseRecord) => {
      if (this.disposed) return Promise.resolve()
      this.browse = normalizeBrowseRecord(change(cloneBrowseRecord(this.browse)), 'win32'); this.render(); return Promise.resolve()
    }
    const browse: BrowsePanelActions = {
      toggle: key => keep(record => ({ ...record, expanded: record.expanded.includes(key) ? record.expanded.filter(candidate => candidate !== key) : [...record.expanded, key] })),
      setActive: active => keep(record => ({ ...record, active })),
      setCollapsed: collapsed => keep(record => ({ ...record, collapsed })),
      addRoot: path => keep(record => ({ ...record, roots: [...record.roots, path] })),
      removeRoot: path => keep(record => ({ ...record, roots: record.roots.filter(root => locationId('folder', root, 'win32') !== locationId('folder', path, 'win32')) })),
      saveRoots: change => keep(record => ({ ...record, ...change })),
    }
    this.renderer = new FavoritesPanelRenderer(this.panel, {
      change: operation => { if (!this.disposed) { apply(operation); this.render() } },
      commit: async draft => {
        if (this.disposed) throw new Error('The preview is closed.')
        this.state = replayFavoritesDraft(this.state, draft, 'win32'); this.render(); return this.state
      },
      open: () => this.explain('Preview only. No document or folder was opened.'),
      reveal: () => this.explain('Preview only. No file manager was opened.'),
      settings: () => this.explain('Preview only. Use the settings alongside this panel.'),
      browse,
    })
    this.render()
  }

  private explain(message: string) { if (!this.disposed) { this.status.textContent = message; this.status.hidden = false } }
  /** Lists every expanded sample folder on screen at once, so the preview never shows "Loading…". */
  private browseSnapshot(): BrowseSnapshot {
    for (let pass = 0; pass < 20; pass++) {
      const { missing } = browseRows(browseTops(this.browse, SAMPLE_HOME, 'win32'), this.folders, new Set(this.browse.expanded), 'win32')
      if (!missing.length) break
      for (const { key, path } of missing) {
        this.folders[key] = { status: 'ready', entries: key === DRIVES_KEY ? ['C:/', 'D:/'].map(root => ({ kind: 'folder', name: folderName(root), path: root })) : sampleEntries(path ?? '') }
      }
    }
    return { available: true, record: cloneBrowseRecord(this.browse), home: SAMPLE_HOME, folders: { ...this.folders }, writable: true }
  }
  private render() {
    if (this.disposed) return
    this.renderer.update({ state: this.state, platform: 'win32', writable: true, current: { file: 'C:/Example/Notes/Ideas.md', folder: 'C:/Example/Notes' }, history: normalizeHistory({
      status: 'ready', order: 'global', entries: [
        { kind: 'file', path: 'C:/Example/Notes/Ideas.md' },
        { kind: 'folder', path: 'C:/Example/Notes' },
        { kind: 'file', path: 'C:/Example/Projects/Atlas/Project brief.md' },
      ],
    }, 'win32'), browse: this.browseSnapshot() })
  }
  dispose() { this.disposed = true; this.renderer.dispose(); this.element.remove() }
}
