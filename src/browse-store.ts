import { locationId, normalizePath, type Platform } from './model'
import { SharedRecordStore } from './record-store'

export type PanelTab = 'favorites' | 'recent' | 'browse'
export const PANEL_TABS: readonly PanelTab[] = Object.freeze(['favorites', 'recent', 'browse'])
/** A place in Browse's top rows: `root` stands for the next folder in `roots`. */
export type BrowseTopKind = 'root' | 'home' | 'drives'

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
  /**
   * Where Home and Drives sit among the roots, such as `['root', 'home', 'root', 'drives']`. Roots keep
   * their own order in `roots`, so 0.2.0 still reads them. It drops this key when it saves, and Home
   * and Drives then go back to after the roots.
   */
  tops: BrowseTopKind[]
}
export const DEFAULT_BROWSE: Readonly<BrowseRecord> = Object.freeze({ roots: [], home: true, drives: true, active: false, collapsed: false, expanded: [], order: [...PANEL_TABS], tops: ['home', 'drives'] as BrowseTopKind[] })
const MAX_ROOTS = 50, MAX_EXPANDED = 500
/** An explicit copy: Browse runs on every render, and older macOS WebKit has no structuredClone. */
export function cloneBrowseRecord(record: Readonly<BrowseRecord>): BrowseRecord {
  return { ...record, roots: [...record.roots], expanded: [...record.expanded], order: [...record.order], tops: [...record.tops] }
}
/** Always all three tabs: unknown and repeated names are dropped, and missing tabs follow in their usual order. */
function normalizeOrder(value: unknown): PanelTab[] {
  const named = Array.isArray(value) ? value.filter((tab): tab is PanelTab => PANEL_TABS.includes(tab as PanelTab)) : []
  return [...new Set([...named, ...PANEL_TABS])]
}
/**
 * One place for each root, Home and Drives. Unknown and repeated places are dropped, and so are places
 * for roots that are gone, from the end. Roots without a place, such as ones 0.2.0 added, follow the
 * last placed root, or lead when none is placed. A missing Home or Drives goes last.
 */
export function normalizeTops(value: unknown, roots: number): BrowseTopKind[] {
  const tops: BrowseTopKind[] = []
  let placed = 0
  for (const top of Array.isArray(value) ? value : []) {
    if (top === 'root') { if (placed < roots) { tops.push(top); placed++ } }
    else if ((top === 'home' || top === 'drives') && !tops.includes(top)) tops.push(top)
  }
  tops.splice(tops.lastIndexOf('root') + 1, 0, ...Array.from({ length: roots - placed }, () => 'root' as const))
  for (const top of ['home', 'drives'] as const) if (!tops.includes(top)) tops.push(top)
  return tops
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
  return { roots, home: flag('home'), drives: flag('drives'), active: flag('active'), collapsed: flag('collapsed'), expanded, order: normalizeOrder(raw.order), tops: normalizeTops(raw.tops, roots.length) }
}

export class BrowseStore extends SharedRecordStore<BrowseRecord> {
  constructor(platform: Platform, databaseName?: string) { super('browse', value => normalizeBrowseRecord(value, platform), databaseName) }
}
