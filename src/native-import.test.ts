import { describe, expect, it } from 'vitest'
import { parseTyporaRecent } from './native-import'

describe('manual Typora Recent snapshot', () => {
  it('uses native cross-kind date order, deduplicates identities, and never invents ages', () => {
    const result = parseTyporaRecent({ files: [
      { path: 'C:/Fixture/A.md', date: 10 }, { path: 'c:/fixture/a.md', date: 30 }, { path: 'C:/Fixture/image.png', date: 50 },
    ], folders: [{ path: 'C:/Fixture/Folder', date: 20, pinned: true }] }, 'win32')
    expect(result.status).toBe('ready'); expect(result.order).toBe('global')
    expect(result.entries.map(row => row.kind)).toEqual(['file', 'folder'])
    expect(result.entries.every(row => row.openedAt === undefined)).toBe(true)
    expect(result.entries[0].path).toBe('c:/fixture/a.md')
  })
  it('keeps missing dates as separate per-kind order instead of fabricating mixed recency', () => {
    const result = parseTyporaRecent({ files: [{ path: 'C:/Fixture/A.md' }], folders: [{ path: 'C:/Fixture' }] }, 'win32')
    expect(result).toMatchObject({ status: 'ready', order: 'per-kind' })
    expect(result.entries).toHaveLength(2)
  })
  it('accepts the date forms that Typora\'s own Recent menu sorts on', () => {
    const result = parseTyporaRecent({
      files: [{ path: 'C:/Fixture/Old.md', date: '100' }, { path: 'C:/Fixture/New.md', date: new Date(300) }],
      folders: [{ path: 'C:/Fixture/Folder', date: 200 }],
    }, 'win32')
    expect(result.order).toBe('global')
    expect(result.entries.map(row => row.path)).toEqual(['C:/Fixture/New.md', 'C:/Fixture/Folder', 'C:/Fixture/Old.md'])
    expect(result.entries.every(row => row.openedAt === undefined)).toBe(true)
  })
  it('keeps per-kind order when any date is not one Typora could sort', () => {
    for (const date of ['yesterday', '', ' ', true, -5, Number.NaN, {}, null]) {
      const result = parseTyporaRecent({ files: [{ path: 'C:/Fixture/A.md', date: 1 }], folders: [{ path: 'C:/Fixture', date }] }, 'win32')
      expect(result.order).toBe('per-kind')
    }
  })
  it('treats an empty native list as a successful empty replacement', () => {
    expect(parseTyporaRecent({ files: [], folders: [] }, 'win32')).toMatchObject({ status: 'ready', entries: [] })
  })
  it('rejects malformed payloads without disclosing their contents', () => {
    for (const raw of [null, {}, { files: null, folders: [] }, { files: ['private'], folders: [] }, { files: [{ path: 'relative.md' }], folders: [] }]) {
      const result = parseTyporaRecent(raw, 'win32')
      expect(result.status).toBe('error'); expect(result.entries).toEqual([])
      expect(result.message).not.toContain('private')
    }
  })
  it('does not claim support for a platform whose reader has not been established', () => {
    expect(parseTyporaRecent({ files: [], folders: [] }, 'darwin').status).toBe('unavailable')
  })
})
