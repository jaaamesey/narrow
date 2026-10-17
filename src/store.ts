import { create, type Draft } from 'mutative'

/** Anything a store can hold: objects and arrays (not primitives). */
export type Container = object

/**
 * Return type allowed for a "mutate" recipe. Must be void-ish so that a
 * recipe that looks like a swap (`s => ({ a: 1 })`) is a type error, but
 * expression-bodied assignments (`s => (s.a = 1)`) still compile.
 */
type MutateResult<T, R> = [R] extends [void | undefined]
  ? R
  : [R] extends [Partial<T>]
    ? 'recipe returned a new state: pass "swap" as the second argument'
    : R

export interface SetStore<T extends Container> {
  /** Full swap. */
  (next: T): void
  /** Fine-grained mutation (the default for functions). Must not return a new state. */
  <R>(recipe: (draft: Draft<T>) => MutateResult<T, R>, mode?: 'mutate'): void
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
 * A store that is a live projection of `source`: reads go through
 * `source.get()`, writes are applied to `source`. `narrowFn` must return a
 * node *inside* the source state (so it also works on drafts).
 */
export function narrowStore<T extends Container, N extends Container>(
  source: Store<T>,
  narrowFn: (state: T) => N,
): Store<N> {
  // If the target disappears (e.g. a list item was removed) while a child that
  // still points at it hasn't unmounted yet, keep serving the last value
  // rather than crashing mid-render. Writes to a missing target are no-ops.
  let last = narrowFn(source.get())
  const get = () => (last = narrowFn(source.get()) ?? last)

  const set = (next: unknown, mode?: 'mutate' | 'swap') => {
    mode ??= typeof next === 'function' ? 'mutate' : 'swap'
    source.set((draft: Draft<T>) => {
      const target = narrowFn(draft as T) as N | undefined
      if (target == null) return
      if (mode === 'mutate') {
        ;(next as (d: unknown) => unknown)(target)
      } else {
        const current = narrowFn(source.get())
        replaceInPlace(target, typeof next === 'function' ? next(current) : next)
      }
    })
  }

  return { get, set: set as SetStore<N>, subscribe: source.subscribe }
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
