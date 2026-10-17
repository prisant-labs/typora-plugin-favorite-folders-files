import {
  createFavoritesState,
  UNGROUPED_GROUP_ID,
  validateFavoritesState,
  validateState,
  type FavoritesState,
  type Platform,
  type State,
} from './model'

export type FavoritesMigration =
  | { state: FavoritesState; migrated: false }
  | { state: FavoritesState; migrated: true; recovery: State }

/**
 * structuredClone where it exists. Older macOS WebKit lacks it, so the fallback copies what a v1
 * record can hold: plain objects, arrays, dates and primitives, cycles included. Any other object
 * is kept by reference, which is safe because the recovery copy is only written, never changed.
 */
function cloneRecord(value: unknown, copies = new Map<object, unknown>()): unknown {
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (value === null || typeof value !== 'object') return value
  if (copies.has(value)) return copies.get(value)
  if (value instanceof Date) return new Date(value.getTime())
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
  // The original length keeps trailing holes, and defining each key keeps an own "__proto__" field,
  // which plain assignment would treat as the prototype setter.
  const copy: object = Array.isArray(value) ? new Array(value.length) : {}
  copies.set(value, copy)
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, { value: cloneRecord((value as Record<string, unknown>)[key], copies), writable: true, enumerable: true, configurable: true })
  }
  return copy
}

/**
 * Convert only validated v1 pins. Legacy recent-only rows stay exclusively in
 * the recovery copy; native Recent must never be reconstructed from them.
 */
export function migrateToFavorites(value: unknown, platform: Platform): FavoritesMigration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved state')
  const version = (value as { version?: unknown }).version
  if (version === 2) return { state: validateFavoritesState(value, platform), migrated: false }
  if (version !== 1) throw new Error('Unsupported saved state version')

  const legacy = validateState(value, platform)
  // The validated view drives migration; recovery retains every original
  // structured-cloneable field, including extensions unknown to this version.
  const recovery = cloneRecord(value) as State
  const state = createFavoritesState()
  state.favorites = legacy.items.filter(item => item.pinned).map(item => ({
    id: item.id,
    kind: item.kind,
    path: item.path,
    groupId: UNGROUPED_GROUP_ID,
  }))
  state.itemOrder[UNGROUPED_GROUP_ID] = state.favorites.map(favorite => favorite.id)
  return { state: validateFavoritesState(state, platform), migrated: true, recovery }
}

/** Compare the complete recovery value, including undefined and nested fields. */
export function recoveryRecordsMatch(first: unknown, second: unknown, seen = new Map<object, object>()): boolean {
  if (Object.is(first, second)) return true
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false
  if (seen.has(first)) return seen.get(first) === second
  if (Object.prototype.toString.call(first) !== Object.prototype.toString.call(second)) return false
  seen.set(first, second)
  if (first instanceof Date && second instanceof Date) return Object.is(first.getTime(), second.getTime())
  if (first instanceof RegExp && second instanceof RegExp) return first.source === second.source && first.flags === second.flags
  // Historical v1 data is plain structured data. Unrecognized opaque objects
  // fail closed rather than comparing only their empty enumerable properties.
  if (!Array.isArray(first) && Object.getPrototypeOf(first) !== Object.prototype && Object.getPrototypeOf(first) !== null) return false
  const keys = Reflect.ownKeys(first)
  if (keys.length !== Reflect.ownKeys(second).length) return false
  return keys.every(key => Object.hasOwn(second, key) && recoveryRecordsMatch(Reflect.get(first, key), Reflect.get(second, key), seen))
}
