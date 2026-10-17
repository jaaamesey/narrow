import { create, original, type Draft } from 'mutative'

/** Anything a store can hold: objects and arrays (not primitives). */
export type Container = object

type Primitive = string | number | boolean | bigint | symbol | null | undefined

/**
 * A "mutate" recipe may only return void or a primitive (so expression-bodied
 * assignments like `s => (s.a = 1)` compile). Returning an object is almost
 * certainly a forgotten "swap", so it is a type error.
 */
type MutateResult<R> = [R] extends [void | Primitive]
  ? R
  : 'recipe returned an object: it mutates by default. Pass "swap" as the second argument to replace the state'

export interface SetStore<T extends Container> {
  /** Full swap. */
  (next: T): void
  /** Fine-grained mutation (the default for functions). Must not return a new state. */
  <R>(recipe: (draft: Draft<T>) => MutateResult<R>, mode?: 'mutate'): void
  /** Full swap computed from the current state. */
  (recipe: (current: T) => T, mode: 'swap'): void
}

export interface Store<T extends Container> {
  get(): T
  /** Stable for the lifetime of the store. */
  set: SetStore<T>
  subscribe(listener: () => void): () => void
}

export function createStore<T extends Container>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()

  const set = (next: unknown, mode?: 'mutate' | 'swap') => {
    mode ??= typeof next === 'function' ? 'mutate' : 'swap'
    const prev = state
    if (mode === 'swap') {
      state = (typeof next === 'function' ? next(prev) : next) as T
    } else {
      // Return values are ignored in mutate mode (the types forbid them).
      state = create(prev, (draft) => void (next as (d: Draft<T>) => unknown)(draft))
    }
    if (!Object.is(prev, state)) [...listeners].forEach((l) => l())
  }

  return {
    get: () => state,
    set: set as SetStore<T>,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/**
 * Turn a parent setter into a setter for the node `narrowFn` picks out of the
 * parent state. `narrowFn` is applied to the parent's draft, so it must return
 * a node *inside* the state. Writes to a node that no longer exists are no-ops.
 */
export function narrowSetter<T extends Container, N extends Container>(
  parentSet: SetStore<T>,
  narrowFn: (state: T) => N | undefined,
): SetStore<N> {
  const set = (next: unknown, mode?: 'mutate' | 'swap') => {
    mode ??= typeof next === 'function' ? 'mutate' : 'swap'
    parentSet((draft: Draft<T>) => {
      const target = narrowFn(draft as T)
      if (target == null) return
      if (mode === 'mutate') {
        ;(next as (d: unknown) => unknown)(target)
      } else {
        const current = original(target) ?? target
        replaceInPlace(target, typeof next === 'function' ? next(current) : next)
      }
    })
  }
  return set as SetStore<N>
}

/** Make `target` (a draft) structurally equal to `next` without replacing the node. */
function replaceInPlace(target: any, next: any) {
  if (target === next) return
  if (Array.isArray(target) && Array.isArray(next)) {
    target.length = next.length
    next.forEach((v, i) => (target[i] = v))
  } else if (target instanceof Map && next instanceof Map) {
    target.clear()
    next.forEach((v, k) => target.set(k, v))
  } else if (target instanceof Set && next instanceof Set) {
    target.clear()
    next.forEach((v) => target.add(v))
  } else if (
    Object.getPrototypeOf(target) === Object.getPrototypeOf(next) &&
    !(target instanceof Map || target instanceof Set || Array.isArray(target))
  ) {
    for (const k of Object.keys(target)) if (!(k in next)) delete target[k]
    Object.assign(target, next)
  } else {
    throw new TypeError('narrow: a narrowed store can only be swapped for a value of the same kind (object/array/Map/Set)')
  }
}
