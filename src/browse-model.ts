import type { BrowseEntry } from './browse-fs'
import { normalizeTops, type BrowseRecord, type BrowseTopKind } from './browse-store'
import { locationId, normalizePath, type Platform } from './model'

/** Shared by the native plugin and the self-contained visual anchor. No Node APIs. */
export const DRIVES_KEY = 'drives'
export const CHOOSER_FAILED = 'Typora\'s folder chooser could not be opened. Type the folder\'s full path instead.'
export interface BrowseFolder { status: 'loading' | 'ready' | 'error'; entries: BrowseEntry[]; error?: string }
/** Listings by expansion key: a folder's location ID, or DRIVES_KEY. */
export type BrowseFolders = Record<string, BrowseFolder>
export interface BrowseTop { key: string; kind: BrowseTopKind; path?: string; name: string }
/** One entry in the arrangeable list of roots, Home and Drives. */
export type BrowsePlace = { kind: 'root'; path: string } | { kind: 'home' } | { kind: 'drives' }
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
export function rootExample(platform: Platform) { return platform === 'win32' ? 'D:\\Notes' : '/Volumes/Notes' }
export function rootId(path: string, platform: Platform) { try { return locationId('folder', path, platform) } catch { return path } }
/** Adds a typed or chosen folder after the roots, or says why it cannot be added. Shared by the panel and the settings page. */
export function withRoot(roots: readonly string[], value: string, platform: Platform): { roots: string[] } | { error: string } {
  let path: string
  try { path = normalizePath(value.trim(), platform) } catch { return { error: `Enter a full folder path, such as ${rootExample(platform)}.` } }
  const id = rootId(path, platform)
  if (roots.some(root => rootId(root, platform) === id)) return { error: 'That folder is already a root.' }
  return { roots: [...roots, path] }
}

/** Roots, Home and Drives in the user's order. Shared by the panel's roots page and the settings page. */
export function browsePlaces(roots: readonly string[], tops: readonly BrowseTopKind[]): BrowsePlace[] {
  let next = 0
  return normalizeTops(tops, roots.length).map(kind => kind === 'root' ? { kind, path: roots[next++] } : { kind })
}
/** The list back as the record keeps it: the roots in order, and where Home and Drives sit among them. */
export function splitPlaces(places: readonly BrowsePlace[]): { roots: string[]; tops: BrowseTopKind[] } {
  return { roots: places.flatMap(place => place.kind === 'root' ? [place.path] : []), tops: places.map(place => place.kind) }
}
export function placeId(place: BrowsePlace, platform: Platform) { return place.kind === 'root' ? rootId(place.path, platform) : place.kind }
export function drivesName(platform: Platform) { return platform === 'darwin' ? 'Volumes' : 'Drives' }

export function browseTops(record: BrowseRecord, home: string | undefined, platform: Platform): BrowseTop[] {
  return browsePlaces(record.roots, record.tops).flatMap((place): BrowseTop[] => {
    if (place.kind === 'root') return [{ key: browseKey(place.path, platform), kind: 'root', path: place.path, name: folderName(place.path) }]
    if (place.kind === 'home') return record.home && home ? [{ key: browseKey(home, platform), kind: 'home', path: home, name: 'Home' }] : []
    return record.drives ? [{ key: DRIVES_KEY, kind: 'drives', name: drivesName(platform) }] : []
  })
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
