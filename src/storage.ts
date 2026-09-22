import { applyOperation, createState, validateState } from './model'
import type { Operation, Platform, State } from './model'

/** Browser-origin storage shared by Typora windows with the same origin/profile. */
export class IndexedDbStore {
  private connection?: Promise<IDBDatabase>

  constructor(private readonly platform: Platform, private readonly databaseName = 'prisant-labs.quick-access') {}

  async read(): Promise<State> {
    return this.transact('readonly')
  }

  async update(operation: Operation): Promise<State> {
    return this.transact('readwrite', operation)
  }

  async close(): Promise<void> {
    const connection = this.connection
    this.connection = undefined
    if (connection) (await connection.catch(() => undefined))?.close()
  }

  private async transact(mode: IDBTransactionMode, operation?: Operation): Promise<State> {
    const database = await this.open()
    return new Promise<State>((resolve, reject) => {
      const transaction = database.transaction('state', mode)
      const store = transaction.objectStore('state')
      let result: State
      let failure: unknown
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Quick Access storage transaction aborted'))
      transaction.onerror = () => { failure ??= transaction.error }
      const request = store.get('current')
      const count = store.count('current')
      count.onsuccess = () => {
        try {
          // Distinguish an absent record from a corrupt record containing undefined.
          const saved = count.result === 0 ? createState() : validateState(request.result, this.platform)
          // No asynchronous gap: the read, operation, and write stay in one transaction.
          result = operation ? applyOperation(saved, operation, this.platform) : saved
          if (operation) store.put(validateState(result, this.platform), 'current')
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
    })
  }

  private open(): Promise<IDBDatabase> {
    if (!this.connection) {
      const connection = new Promise<IDBDatabase>((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new Error('IndexedDB storage is unavailable in this Typora window'))
          return
        }
        let rejected = false
        const request = indexedDB.open(this.databaseName, 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state')
        }
        request.onsuccess = () => {
          const database = request.result
          if (rejected) {
            database.close()
            return
          }
          database.onversionchange = () => {
            database.close()
            this.connection = undefined
          }
          resolve(database)
        }
        request.onerror = () => reject(request.error ?? new Error('Could not open Quick Access storage'))
        request.onblocked = () => {
          rejected = true
          reject(new Error('Quick Access storage is blocked by another window'))
        }
      })
      this.connection = connection
      void connection.catch(() => { if (this.connection === connection) this.connection = undefined })
    }
    return this.connection
  }
}
