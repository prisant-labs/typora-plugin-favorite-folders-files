/**
 * One record of the Favorites database that saved Favorites never read.
 * Saved Favorites accept an exact set of preference keys, so settings added later live in records
 * of their own: older windows and downgrades read only their own records and never see these.
 */
export class SharedRecordStore<T> {
  private connection?: Promise<IDBDatabase>

  constructor(
    private readonly key: string,
    /** Turns anything stored, including nothing or garbage, into a valid record. */
    private readonly normalize: (value: unknown) => T,
    private readonly databaseName = 'prisant-labs.favorite-folders-files',
  ) {}

  /** Never rejects: an unreadable record reads as the defaults. */
  async read(): Promise<T> {
    try {
      const database = await this.open()
      return await new Promise<T>((resolve, reject) => {
        const request = database.transaction('state', 'readonly').objectStore('state').get(this.key)
        request.onsuccess = () => resolve(this.normalize(request.result))
        request.onerror = () => reject(request.error)
      })
    } catch { return this.normalize(undefined) }
  }

  /** Reads, changes and writes the record in one transaction, so two windows never overwrite each other's change. */
  async update(change: (record: T) => T): Promise<T> {
    const database = await this.open()
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite')
      const store = transaction.objectStore('state')
      let result: T, failure: unknown
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('The setting could not be saved.'))
      const request = store.get(this.key)
      request.onsuccess = () => {
        try {
          result = this.normalize(change(this.normalize(request.result)))
          store.put(result, this.key)
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
