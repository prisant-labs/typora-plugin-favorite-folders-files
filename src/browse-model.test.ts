import { describe, expect, it } from 'vitest'
import { DEFAULT_BROWSE } from './browse-store'
import { browseKey, browsePlaces, browseRows, browseTops, DRIVES_KEY, folderName, placeId, splitPlaces, withRoot, type BrowseFolders } from './browse-model'

const record = (patch: Partial<typeof DEFAULT_BROWSE>) => ({ ...DEFAULT_BROWSE, ...patch })

describe('Browse tree', () => {
  it('names folders, drive roots and network shares', () => {
    expect(folderName('C:/Synthetic/Projects')).toBe('Projects')
    expect(folderName('C:/')).toBe('C:')
    expect(folderName('//server/share')).toBe('share')
    expect(folderName('/')).toBe('/')
  })

  it('lists roots in order, then Home and the drives', () => {
    const tops = browseTops(record({ roots: ['C:/Synthetic/Projects', 'D:/'] }), 'C:/Users/Synthetic', 'win32')
    expect(tops).toEqual([
      { key: 'folder:c:/synthetic/projects', kind: 'root', path: 'C:/Synthetic/Projects', name: 'Projects' },
      { key: 'folder:d:/', kind: 'root', path: 'D:/', name: 'D:' },
      { key: 'folder:c:/users/synthetic', kind: 'home', path: 'C:/Users/Synthetic', name: 'Home' },
      { key: DRIVES_KEY, kind: 'drives', name: 'Drives' },
    ])
    expect(browseTops(record({ home: false }), '/Home', 'darwin')).toEqual([{ key: DRIVES_KEY, kind: 'drives', name: 'Volumes' }])
    // Home is left out when Typora cannot say where it is.
    expect(browseTops(record({ drives: false }), undefined, 'darwin')).toEqual([])
  })

  it('puts Home and the drives where the user placed them, and skips a hidden one without moving the rest', () => {
    const placed = record({ roots: ['/Synthetic/Atlas', '/Synthetic/Beacon'], tops: ['home', 'root', 'drives', 'root'] })
    expect(browseTops(placed, '/Home', 'darwin').map(top => top.name)).toEqual(['Home', 'Atlas', 'Volumes', 'Beacon'])
    expect(browseTops({ ...placed, home: false }, '/Home', 'darwin').map(top => top.name)).toEqual(['Atlas', 'Volumes', 'Beacon'])
  })

  it('lists roots, Home and the drives as one arrangeable list, and splits it back for saving', () => {
    const places = browsePlaces(['/Synthetic/Atlas', '/Synthetic/Beacon'], ['home', 'root', 'drives', 'root'])
    expect(places).toEqual([{ kind: 'home' }, { kind: 'root', path: '/Synthetic/Atlas' }, { kind: 'drives' }, { kind: 'root', path: '/Synthetic/Beacon' }])
    expect(places.map(place => placeId(place, 'darwin'))).toEqual(['home', 'folder:/Synthetic/Atlas', 'drives', 'folder:/Synthetic/Beacon'])
    expect(splitPlaces([...places].reverse())).toEqual({ roots: ['/Synthetic/Beacon', '/Synthetic/Atlas'], tops: ['root', 'drives', 'root', 'home'] })
    // A root added without a place follows the last placed root.
    expect(browsePlaces(['/Synthetic/Atlas', '/Synthetic/Beacon'], ['home', 'root', 'drives']).map(place => place.kind)).toEqual(['home', 'root', 'root', 'drives'])
  })

  it('shows collapsed tops only, and asks for the listings that expanded folders need', () => {
    const tops = browseTops(record({ roots: ['/Synthetic'] }), '/Home', 'darwin')
    expect(browseRows(tops, {}, new Set(), 'darwin')).toMatchObject({ rows: [{ type: 'root', depth: 0, expanded: false }, { type: 'home' }, { type: 'drives' }], missing: [] })
    const expanded = new Set([browseKey('/Synthetic', 'darwin'), DRIVES_KEY])
    const { rows, missing } = browseRows(tops, {}, expanded, 'darwin')
    expect(rows.map(row => `${row.depth}:${row.type}:${row.name}`)).toEqual(['0:root:Synthetic', '1:note:Loading…', '0:home:Home', '0:drives:Volumes', '1:note:Loading…'])
    expect(missing).toEqual([{ key: 'folder:/Synthetic', path: '/Synthetic' }, { key: DRIVES_KEY }])
  })

  it('nests expanded folders and never expands files', () => {
    const tops = browseTops(record({ roots: ['/Synthetic'], home: false, drives: false }), undefined, 'darwin')
    const folders: BrowseFolders = {
      'folder:/Synthetic': { status: 'ready', entries: [{ kind: 'folder', name: 'Atlas', path: '/Synthetic/Atlas' }, { kind: 'file', name: 'Brief.md', path: '/Synthetic/Brief.md' }] },
      'folder:/Synthetic/Atlas': { status: 'ready', entries: [] },
    }
    const expanded = new Set(['folder:/Synthetic', 'folder:/Synthetic/Atlas', 'folder:/Synthetic/Brief.md'])
    const { rows, missing } = browseRows(tops, folders, expanded, 'darwin')
    expect(rows.map(row => `${row.depth}:${row.type}:${row.name}:${row.expanded ?? '-'}`)).toEqual([
      '0:root:Synthetic:true', '1:folder:Atlas:true', '2:note:No folders or Markdown files:-', '1:file:Brief.md:-',
    ])
    expect(missing).toEqual([])
  })

  it('shows a listing error, and keeps earlier entries while a folder reloads', () => {
    const tops = browseTops(record({ roots: ['/Synthetic', '/Private'], home: false, drives: false }), undefined, 'darwin')
    const folders: BrowseFolders = {
      'folder:/Synthetic': { status: 'loading', entries: [{ kind: 'file', name: 'Kept.md', path: '/Synthetic/Kept.md' }] },
      'folder:/Private': { status: 'error', entries: [], error: 'No access' },
    }
    const { rows } = browseRows(tops, folders, new Set(['folder:/Synthetic', 'folder:/Private']), 'darwin')
    expect(rows.map(row => `${row.type}:${row.name}`)).toEqual(['root:Synthetic', 'file:Kept.md', 'root:Private', 'note:No access'])
    expect(rows[3].note).toBe('error')
  })

  it('lists drives under the drives row, and gives repeated folders distinct row IDs', () => {
    const tops = browseTops(record({ roots: ['C:/Synthetic'], home: false }), undefined, 'win32')
    const folders: BrowseFolders = {
      [DRIVES_KEY]: { status: 'ready', entries: [{ kind: 'folder', name: 'C:', path: 'C:/' }] },
      'folder:c:/': { status: 'ready', entries: [{ kind: 'folder', name: 'Synthetic', path: 'C:/Synthetic' }] },
      'folder:c:/synthetic': { status: 'ready', entries: [{ kind: 'file', name: 'Note.md', path: 'C:/Synthetic/Note.md' }] },
    }
    const { rows } = browseRows(tops, folders, new Set([DRIVES_KEY, 'folder:c:/', 'folder:c:/synthetic']), 'win32')
    expect(rows.map(row => `${row.depth}:${row.type}:${row.name}`)).toEqual([
      '0:root:Synthetic', '1:file:Note.md', '0:drives:Drives', '1:drive:C:', '2:folder:Synthetic', '3:file:Note.md',
    ])
    const ids = rows.map(row => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    // Both copies of the folder share one expansion key.
    expect(rows[0].key).toBe(rows[4].key)
  })
})

describe('Adding a root', () => {
  it('normalizes a typed or chosen folder, and refuses a relative path or a repeat', () => {
    expect(withRoot(['C:/Projects'], '  D:\\Notes\\Archive\\ ', 'win32')).toEqual({ roots: ['C:/Projects', 'D:/Notes/Archive'] })
    expect(withRoot(['C:/Projects'], '\\\\server\\share\\notes', 'win32')).toEqual({ roots: ['C:/Projects', '//server/share/notes'] })
    expect(withRoot(['C:/Projects'], 'c:\\projects', 'win32')).toEqual({ error: 'That folder is already a root.' })
    expect(withRoot([], 'Notes', 'win32')).toEqual({ error: 'Enter a full folder path, such as D:\\Notes.' })
    expect(withRoot(['/Projects'], '/Projects/', 'darwin')).toEqual({ error: 'That folder is already a root.' })
    expect(withRoot([], '~/Notes', 'darwin')).toEqual({ error: 'Enter a full folder path, such as /Volumes/Notes.' })
  })
})
