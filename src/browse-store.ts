import { locationId, normalizePath, type Platform } from './model'
import { SharedRecordStore } from './record-store'

export type PanelTab = 'favorites' | 'recent' | 'browse'
export const PANEL_TABS: readonly PanelTab[] = Object.freeze(['favorites', 'recent', 'browse'])

/** Browse's settings and view state. Saved Favorites never hold any of it, so 0.1.4 windows keep working. */
export interface BrowseRecord {
  /** Root folders in the user's order, as normalized absolute paths. */
  roots: string[]
  home: boolean
  drives: boolean
  /** Browse is the selected tab. Favorites' own `activeTab` keeps the tab to return to. */
  active: boolean
  /** The Browse section is collapsed in the Stacked layout. */
  collapsed: boolean
  /** Expanded folders as `folder:` location IDs, or `drives`, most recently expanded last. */
  expanded: string[]
  /**
   * The panel's tabs, and its Stacked sections, in the user's order. It lives here, not in the
   * Favorites preferences, because 0.1.4 rejects saved preferences that hold a key it doesn't know.
   */
  order: PanelTab[]
}
export const DEFAULT_BROWSE: Readonly<BrowseRecord> = Object.freeze({ roots: [], home: true, drives: true, active: false, collapsed: false, expanded: [], order: [...PANEL_TABS] })
const MAX_ROOTS = 50, MAX_EXPANDED = 500
/** An explicit copy: Browse runs on every render, and older macOS WebKit has no structuredClone. */
export function cloneBrowseRecord(record: Readonly<BrowseRecord>): BrowseRecord {
  return { ...record, roots: [...record.roots], expanded: [...record.expanded], order: [...record.order] }
}
/** Always all three tabs: unknown and repeated names are dropped, and missing tabs follow in their usual order. */
function normalizeOrder(value: unknown): PanelTab[] {
  const named = Array.isArray(value) ? value.filter((tab): tab is PanelTab => PANEL_TABS.includes(tab as PanelTab)) : []
  return [...new Set([...named, ...PANEL_TABS])]
}

export function normalizeBrowseRecord(value: unknown, platform: Platform): BrowseRecord {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const flag = (key: keyof BrowseRecord) => typeof raw[key] === 'boolean' ? raw[key] as boolean : DEFAULT_BROWSE[key] as boolean
  const roots: string[] = [], seen = new Set<string>()
  for (const candidate of Array.isArray(raw.roots) ? raw.roots : []) {
    if (roots.length === MAX_ROOTS) break
    try {
      const path = normalizePath(candidate as string, platform), id = locationId('folder', path, platform)
      if (!seen.has(id)) { seen.add(id); roots.push(path) }
    } catch { /* Not an absolute folder path. */ }
  }
  const expanded = [...new Set((Array.isArray(raw.expanded) ? raw.expanded : []).filter((key): key is string => typeof key === 'string' && key.length > 0 && key.length <= 4096))].slice(-MAX_EXPANDED)
  return { roots, home: flag('home'), drives: flag('drives'), active: flag('active'), collapsed: flag('collapsed'), expanded, order: normalizeOrder(raw.order) }
}

export class BrowseStore extends SharedRecordStore<BrowseRecord> {
  constructor(platform: Platform, databaseName?: string) { super('browse', value => normalizeBrowseRecord(value, platform), databaseName) }
}
