import { applyFavoritesOperation, applyOperation, createFavoritesState, createState, validateState } from './model'
import type { FavoritesOperation, FavoritesState, Operation, Platform, State } from './model'
import { migrateToFavorites, recoveryRecordsMatch } from './migration'
import { cloneFavoritesDraft, cloneFavoritesOperation, replayFavoritesDraft, type FavoritesDraft } from './editor-state'

/** Browser-origin storage shared by Typora windows with the same origin/profile. */
export class IndexedDbStore {
  private connection?: Promise<IDBDatabase>

  constructor(private readonly platform: Platform, private readonly databaseName = 'prisant-labs.favorite-folders-files') {}

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

/**
 * Transactional v2 store. A valid v1 record is backed up and replaced inside
 * one IndexedDB transaction, so an interrupted migration commits neither put.
 */
export class FavoritesIndexedDbStore {
  private connection?: Promise<IDBDatabase>

  constructor(private readonly platform: Platform, private readonly databaseName = 'prisant-labs.favorite-folders-files') {}

  async read(): Promise<FavoritesState> {
    // A read may perform the one-time v1 migration.
    return this.transact('readwrite')
  }

  async update(operation: FavoritesOperation): Promise<FavoritesState> {
    return this.transact('readwrite', cloneFavoritesOperation(operation))
  }

  async commitDraft(draft: FavoritesDraft): Promise<FavoritesState> {
    return this.transact('readwrite', undefined, cloneFavoritesDraft(draft))
  }

  async close(): Promise<void> {
    const connection = this.connection
    this.connection = undefined
    if (connection) (await connection.catch(() => undefined))?.close()
  }

  private async transact(mode: IDBTransactionMode, operation?: FavoritesOperation, draft?: FavoritesDraft): Promise<FavoritesState> {
    const database = await this.open()
    return new Promise<FavoritesState>((resolve, reject) => {
      const transaction = database.transaction('state', mode)
      const store = transaction.objectStore('state')
      let result: FavoritesState
      let failure: unknown
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Favorites storage transaction aborted'))
      transaction.onerror = () => { failure ??= transaction.error }

      const current = store.get('current')
      const currentCount = store.count('current')
      const recovery = store.get('recovery:v1')
      const recoveryCount = store.count('recovery:v1')
      recoveryCount.onsuccess = () => {
        try {
          let writeCurrent = false
          if (currentCount.result === 0) {
            if (recoveryCount.result !== 0) throw new Error('Favorites current state is missing while a migration recovery record remains')
            result = createFavoritesState()
          } else {
            const migration = migrateToFavorites(current.result, this.platform)
            result = migration.state
            if (migration.migrated) {
              if (recoveryCount.result === 0) store.put(migration.recovery, 'recovery:v1')
              else if (!recoveryRecordsMatch(recovery.result, migration.recovery)) {
                throw new Error('Favorites migration recovery record does not match the saved v1 state')
              }
              writeCurrent = true
            }
          }
          if (operation) {
            result = applyFavoritesOperation(result, operation, this.platform)
            writeCurrent = true
          }
          if (draft) {
            result = replayFavoritesDraft(result, draft, this.platform)
            writeCurrent = true
          }
          if (writeCurrent) store.put(result, 'current')
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
          const invalidate = () => { if (this.connection === connection) this.connection = undefined }
          database.onclose = invalidate
          database.onversionchange = () => {
            database.close()
            invalidate()
          }
          resolve(database)
        }
        request.onerror = () => reject(request.error ?? new Error('Could not open Favorites storage'))
        request.onblocked = () => {
          rejected = true
          reject(new Error('Favorites storage is blocked by another window'))
        }
      })
      this.connection = connection
      void connection.catch(() => { if (this.connection === connection) this.connection = undefined })
    }
    return this.connection
  }
}
