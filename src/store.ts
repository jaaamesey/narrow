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

/**
 * Every state value a store has held (or a narrowed store has served) maps
 * back to its store. This is what lets plain *values* be passed to
 * `useNarrowedStore` / `<Narrow>` while writes still reach the right store.
 */
const owners = new WeakMap<object, Store<any>>()

/** The store a state value belongs to (any version of it). */
export function storeOf<T extends Container>(value: T): Store<T> {
  const store = owners.get(value)
  if (!store) throw new Error('narrow: not a store value. Pass a value that came from a narrow hook/context (not a copy or unrelated object).')
  return store
}

/** Copy the root so two stores created from the same initial object don't collide in `owners`. */
function shallowClone<T extends Container>(v: T): T {
  if (Array.isArray(v)) return [...v] as T
  if (v instanceof Map) return new Map(v) as T
  if (v instanceof Set) return new Set(v) as T
  return Object.assign(Object.create(Object.getPrototypeOf(v)), v)
}

export function createStore<T extends Container>(initial: T): Store<T> {
  let state = shallowClone(initial)
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
    if (!Object.is(prev, state)) {
      owners.set(state, store)
      ;[...listeners].forEach((l) => l())
    }
  }

  const store: Store<T> = {
    get: () => state,
    set: set as SetStore<T>,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
  owners.set(state, store)
  return store
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
  const get = () => {
    last = narrowFn(source.get()) ?? last
    owners.set(last, narrowed)
    return last
  }

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

  const narrowed: Store<N> = { get, set: set as SetStore<N>, subscribe: source.subscribe }
  return narrowed
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
