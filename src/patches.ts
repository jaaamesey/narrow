import { apply, type Patches } from 'mutative'
import { applyUpdate, applyUpdateWithPatches, type SetStore } from './store.js'

/** Gets each update's JSON patches: what changed, what undoes it, and whether it came from `applyPatches`. */
export type OnPatches = (patches: Patches, inversePatches: Patches, info: { applied: boolean }) => void

export interface StoreOptions {
  /**
   * Called once for each update that changes the state, after it's committed, with Mutative's JSON patches for it
   * and the patches that undo it. Paths are arrays of keys from the store's root.
   */
  onPatches?: OnPatches
}

/** One update's change, from the state before it to the state it made. */
export interface Change {
  prev: object
  next: object
  patches: Patches
  inversePatches: Patches
  applied: boolean
}

// On a store's root setter, and on the actions bound to it: what `applyPatches` writes through.
const ROOT_SET = Symbol('react-narrow root setter')
// On the recipe `applyPatches` makes, so its change is reported as applied.
const APPLIED = Symbol('react-narrow applied patches')

/**
 * Makes a store's root setter. `update` gives it the state and takes the next one. While `recorder()` returns a
 * function, each update makes patches and is passed to it.
 */
export function rootSetter(
  update: (fn: (prev: object) => object) => void,
  recorder: () => ((change: Change) => void) | undefined,
): SetStore<object> {
  const set = (next: unknown, mode?: 'mutate' | 'swap') =>
    update((prev) => {
      const record = recorder()
      if (!record) return applyUpdate(prev, next, mode)
      const [value, patches, inversePatches] = applyUpdateWithPatches(prev, next, mode)
      if (value !== prev) record({ prev, next: value, patches, inversePatches, applied: typeof next === 'function' && APPLIED in next })
      return value
    })
  return markRoot(set as SetStore<object>, set as SetStore<object>)
}

/** Marks `target` (a root setter, or the actions bound to one) as writing through `set`. */
export const markRoot = <T extends object>(target: T, set: SetStore<any>): T =>
  Object.defineProperty(target, ROOT_SET, { value: set })

/**
 * Applies JSON patches to a store, given its setter or its actions: the root ones, since patches from `onPatches`
 * have paths from the root. The update is reported to `onPatches` with `applied: true`, so an undo stack or a sync
 * connection can tell it from the user's own edits.
 */
export function applyPatches(store: SetStore<any> | object, patches: Patches): void {
  const set = (store as { [ROOT_SET]?: SetStore<any> })[ROOT_SET]
  if (!set) throw new Error("react-narrow: applyPatches needs a store's root setter or actions, not a narrowed one")
  const recipe = (draft: object) => void apply(draft, patches, { mutable: true })
  set(Object.assign(recipe, { [APPLIED]: true }))
}
