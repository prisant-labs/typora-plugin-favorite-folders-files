import type { BrowseEntry } from './browse-fs'
import type { BrowseRecord } from './browse-store'
import { locationId, type Platform } from './model'

/** Shared by the native plugin and the self-contained visual anchor. No Node APIs. */
export const DRIVES_KEY = 'drives'
export interface BrowseFolder { status: 'loading' | 'ready' | 'error'; entries: BrowseEntry[]; error?: string }
/** Listings by expansion key: a folder's location ID, or DRIVES_KEY. */
export type BrowseFolders = Record<string, BrowseFolder>
export interface BrowseTop { key: string; kind: 'root' | 'home' | 'drives'; path?: string; name: string }
export interface BrowseRow {
  /** Unique per rendered row, so focus finds the right copy of a folder shown twice. */
  id: string
  /** Expansion key, shared by every copy of the same folder. */
  key: string
  depth: number
  type: BrowseTop['kind'] | 'drive' | 'folder' | 'file' | 'note'
  name: string
  path?: string
  expanded?: boolean
  note?: 'loading' | 'empty' | 'error'
}

export function browseKey(path: string, platform: Platform) { return locationId('folder', path, platform) }
export function folderName(path: string) {
  if (/^[A-Za-z]:\/$/.test(path)) return path.slice(0, 2)
  return path.slice(path.lastIndexOf('/') + 1) || path
}

export function browseTops(record: BrowseRecord, home: string | undefined, platform: Platform): BrowseTop[] {
  const tops: BrowseTop[] = record.roots.map(path => ({ key: browseKey(path, platform), kind: 'root', path, name: folderName(path) }))
  if (record.home && home) tops.push({ key: browseKey(home, platform), kind: 'home', path: home, name: 'Home' })
  if (record.drives) tops.push({ key: DRIVES_KEY, kind: 'drives', name: platform === 'darwin' ? 'Volumes' : 'Drives' })
  return tops
}

/** The visible rows, and the expanded folders that still need a listing. */
export function browseRows(tops: BrowseTop[], folders: BrowseFolders, expanded: ReadonlySet<string>, platform: Platform) {
  const rows: BrowseRow[] = [], missing: Array<{ key: string; path?: string }> = []
  const children = (parent: BrowseRow) => {
    const listing = folders[parent.key]
    if (!listing) missing.push(parent.path === undefined ? { key: parent.key } : { key: parent.key, path: parent.path })
    const depth = parent.depth + 1, note = (kind: BrowseRow['note'], name: string) => rows.push({ id: `${parent.id}>${kind}`, key: parent.key, depth, type: 'note', name, note: kind })
    if (!listing || (listing.status === 'loading' && !listing.entries.length)) { note('loading', 'Loading…'); return }
    if (listing.status === 'error' && !listing.entries.length) { note('error', listing.error || 'Could not be read'); return }
    if (!listing.entries.length) { note('empty', parent.type === 'drives' ? 'No drives found' : 'No folders or Markdown files'); return }
    for (const entry of listing.entries) {
      const key = entry.kind === 'folder' ? browseKey(entry.path, platform) : locationId('file', entry.path, platform)
      add({ id: `${parent.id}>${key}`, key, depth, type: parent.type === 'drives' ? 'drive' : entry.kind, name: entry.name, path: entry.path })
    }
  }
  const add = (row: BrowseRow) => {
    if (row.type === 'file') { rows.push(row); return }
    row.expanded = expanded.has(row.key); rows.push(row)
    if (row.expanded) children(row)
  }
  tops.forEach((top, index) => add({ id: `${index}:${top.key}`, key: top.key, depth: 0, type: top.kind, name: top.name, ...(top.path === undefined ? {} : { path: top.path }) }))
  return { rows, missing }
}
