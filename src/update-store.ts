import type { UpdateRecord, UpdateRecordStore } from './update-check'

const KEY = 'updates'

function normalize(value: unknown): UpdateRecord {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const record: UpdateRecord = { checkForUpdates: typeof raw.checkForUpdates === 'boolean' ? raw.checkForUpdates : true }
  const checked = raw.checked && typeof raw.checked === 'object' ? raw.checked as Record<string, unknown> : undefined
  if (checked && typeof checked.at === 'number' && Number.isFinite(checked.at)) {
    record.checked = typeof checked.version === 'string' ? { at: checked.at, version: checked.version } : { at: checked.at }
  }
  return record
}

/**
 * The update setting and the last completed check, in their own record of the Favorites database.
 * Saved Favorites accept an exact set of preference keys, so this never lives in that state:
 * older windows and downgrades read only their own records and never see this one.
 */
export class FavoritesUpdateStore implements UpdateRecordStore {
  private connection?: Promise<IDBDatabase>

  constructor(private readonly databaseName = 'prisant-labs.favorite-folders-files') {}

  /** Never rejects: an unreadable record reads as automatic checks on and no previous check. */
  async read(): Promise<UpdateRecord> {
    try {
      const database = await this.open()
      return await new Promise<UpdateRecord>((resolve, reject) => {
        const request = database.transaction('state', 'readonly').objectStore('state').get(KEY)
        request.onsuccess = () => resolve(normalize(request.result))
        request.onerror = () => reject(request.error)
      })
    } catch { return normalize(undefined) }
  }

  /** Reads, changes and writes the record in one transaction, so two windows never overwrite each other's change. */
  async update(change: (record: UpdateRecord) => UpdateRecord): Promise<UpdateRecord> {
    const database = await this.open()
    return new Promise<UpdateRecord>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite')
      const store = transaction.objectStore('state')
      let result: UpdateRecord, failure: unknown
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('The update setting could not be saved.'))
      const request = store.get(KEY)
      request.onsuccess = () => {
        try {
          result = normalize(change(normalize(request.result)))
          store.put(result, KEY)
        } catch (error) { failure = error; transaction.abort() }
      }
    })
  }

  async close(): Promise<void> {
    const connection = this.connection
    this.connection = undefined
    if (connection) (await connection.catch(() => undefined))?.close()
  }

  private open(): Promise<IDBDatabase> {
    if (!this.connection) {
      const connection = new Promise<IDBDatabase>((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new Error('IndexedDB storage is unavailable in this Typora window')); return }
        const request = indexedDB.open(this.databaseName, 1)
        // Whichever store opens a new database first creates the shared object store.
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state') }
        request.onsuccess = () => {
          const database = request.result
          const invalidate = () => { if (this.connection === connection) this.connection = undefined }
          database.onclose = invalidate
          database.onversionchange = () => { database.close(); invalidate() }
          resolve(database)
        }
        request.onerror = () => reject(request.error ?? new Error('Could not open Favorites storage'))
        request.onblocked = () => reject(new Error('Favorites storage is blocked by another window'))
      })
      this.connection = connection
      void connection.catch(() => { if (this.connection === connection) this.connection = undefined })
    }
    return this.connection
  }
}
