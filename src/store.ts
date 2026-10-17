import { create, type Draft } from 'mutative'

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

const PATH = Symbol('path')

/**
 * Run `narrowFn` against a proxy that records which keys it reads, and return
 * the path to the node it picked. `undefined` if the node is gone; throws if
 * `narrowFn` returned something that isn't a node inside the state (a copy).
 */
function pathOf(state: object, narrowFn: (state: any) => unknown): PropertyKey[] | undefined {
  const track = (v: unknown, path: PropertyKey[]): unknown =>
    v !== null && typeof v === 'object'
      ? new Proxy(v, { get: (t, k) => (k === PATH ? path : track(Reflect.get(t, k), [...path, k])) })
      : v
  const node = narrowFn(track(state, [])) as any
  if (node == null) return undefined
  const path = node[PATH]
  if (!path) throw new Error('narrow: narrowFn must return a node inside the state, not a copy or a computed value')
  return path
}

const getAt = (v: any, path: PropertyKey[]) => path.reduce((o, k) => o[k], v)

/**
 * Turn a parent setter into a setter for the node `narrowFn` picks out of the
 * parent state. Writes to a node that no longer exists are no-ops.
 */
export function narrowSetter<T extends Container, N extends Container>(
  parentSet: SetStore<T>,
  narrowFn: (state: T) => N | undefined,
): SetStore<N> {
  const set = (next: unknown, mode?: 'mutate' | 'swap') => {
    mode ??= typeof next === 'function' ? 'mutate' : 'swap'
    if (mode === 'mutate') {
      parentSet((draft: Draft<T>) => {
        const path = pathOf(draft, narrowFn)
        if (path) (next as (d: unknown) => unknown)(getAt(draft, path))
      })
    } else {
      parentSet((current: T) => {
        const path = pathOf(current, narrowFn)
        if (!path) return current
        const node = getAt(current, path)
        const value = typeof next === 'function' ? next(node) : next
        if (value === node) return current
        if (!path.length) return value
        return create(current, (d: any) => void (getAt(d, path.slice(0, -1))[path.at(-1)!] = value))
      }, 'swap')
    }
  }
  return set as SetStore<N>
}
