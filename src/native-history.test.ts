import { describe, expect, it } from 'vitest'
import { normalizeHistory, selectRecent, historyActivity, type HistoryInput } from './native-history'

describe('read-only history capabilities', () => {
  it('keeps the latest timestamp for a canonical duplicate before ordering', () => {
    const snapshot = normalizeHistory({ status: 'ready', order: 'timestamps', entries: [
      { kind: 'file', path: 'C:/Fixture/A.md', openedAt: 10 },
      { kind: 'folder', path: 'C:/Fixture/B', openedAt: 20 },
      { kind: 'file', path: 'c:/fixture/a.md', openedAt: 30 },
    ] }, 'win32')
    expect(snapshot.entries.map(row => row.openedAt)).toEqual([30, 20])
  })
  it('fails closed on malformed outer values and rows before filtering file types', () => {
    for (const value of [{ status: 'bogus' }, { status: 'error', message: 17 }, { status: 'ready', order: 'global', entries: [{ kind: 'file', path: 17 }] }, { status: 'ready', order: 'global', entries: [null] }]) {
      expect(normalizeHistory(value as unknown as HistoryInput, 'darwin').status).toBe('unavailable')
    }
  })
  it('fails closed without a verified provider and never reconstructs history', () => {
    const history = normalizeHistory(undefined, 'darwin')
    expect(history.status).toBe('unavailable')
    expect(selectRecent(history, 'all')).toEqual([])
    expect(historyActivity(history)).toEqual({ kind: 'unavailable' })
  })
  it('keeps per-kind ordering separate and provides no mixed recency or invented ages', () => {
    const history = normalizeHistory({ status: 'ready', order: 'per-kind', entries: [
      { kind: 'file', path: '/Fixture/one.md' }, { kind: 'folder', path: '/Fixture' },
    ] }, 'darwin')
    expect(selectRecent(history, 'all')).toEqual([])
    expect(selectRecent(history, 'file')).toHaveLength(1)
    expect(selectRecent(history, 'file')[0].openedAt).toBeUndefined()
    expect(historyActivity(history).kind).toBe('per-kind-order')
  })
  it('deduplicates canonical identities and respects recording off and native clear', () => {
    const input = { status: 'ready' as const, order: 'global' as const, entries: [
      { kind: 'file' as const, path: 'C:/Fixture/one.md' }, { kind: 'file' as const, path: 'c:/fixture/ONE.md' },
    ] }
    expect(selectRecent(normalizeHistory(input, 'win32'), 'all')).toHaveLength(1)
    expect(selectRecent(normalizeHistory({ ...input, status: 'recording-off' }, 'win32'), 'all')).toEqual([])
    expect(selectRecent(normalizeHistory({ ...input, entries: [] }, 'win32'), 'all')).toEqual([])
  })
  it('orders timestamp snapshots globally and omits invalid timestamps and non-Markdown files', () => {
    const history = normalizeHistory({ status: 'ready', order: 'timestamps', entries: [
      { kind: 'file', path: '/Fixture/old.md', openedAt: 10 },
      { kind: 'file', path: '/Fixture/not-markdown.pdf', openedAt: 30 },
      { kind: 'folder', path: '/Fixture', openedAt: 20 },
    ] }, 'darwin')
    expect(selectRecent(history, 'all').map(row => row.path)).toEqual(['/Fixture', '/Fixture/old.md'])
    expect(historyActivity(history).kind).toBe('timestamps')
    expect(normalizeHistory({ status: 'ready', order: 'timestamps', entries: [{ kind: 'file', path: '/Fixture/no.md' }] }, 'darwin').status).toBe('unavailable')
  })
})
