import { SharedRecordStore } from './record-store'
import type { UpdateRecord, UpdateRecordStore } from './update-check'

function normalize(value: unknown): UpdateRecord {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const record: UpdateRecord = { checkForUpdates: typeof raw.checkForUpdates === 'boolean' ? raw.checkForUpdates : true }
  const checked = raw.checked && typeof raw.checked === 'object' ? raw.checked as Record<string, unknown> : undefined
  if (checked && typeof checked.at === 'number' && Number.isFinite(checked.at)) {
    record.checked = typeof checked.version === 'string' ? { at: checked.at, version: checked.version } : { at: checked.at }
  }
  return record
}

/** The update setting and the last completed check, in their own record of the Favorites database. */
export class FavoritesUpdateStore extends SharedRecordStore<UpdateRecord> implements UpdateRecordStore {
  constructor(databaseName?: string) { super('updates', normalize, databaseName) }
}
