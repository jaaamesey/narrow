import { create, type Draft } from 'mutative'

/**
 * Anything a store can hold. Follows Mutative's rules: plain objects, arrays,
 * Maps and Sets are drafted; other objects (Dates, class instances) are values
 * you replace rather than mutate.
 */
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

/**
 * Apply one setter call to `prev`: a mutate recipe through Mutative, or a swap.
 * Pure, so it can run as a React state updater.
 */
export function applyUpdate<T>(prev: T, next: unknown, mode?: 'mutate' | 'swap'): T {
  mode ??= typeof next === 'function' ? 'mutate' : 'swap'
  if (mode === 'swap') return (typeof next === 'function' ? next(prev) : next) as T
  // Return values are ignored in mutate mode (the types forbid them).
  return create(prev, (draft) => void (next as (d: Draft<T>) => unknown)(draft))
}

/**
 * How to narrow a store: a function that walks to a node inside the state
 * (its path is traced automatically), or an explicit `{ get, swap }` for cases
 * the tracer can't follow (identity comparisons, Map entries, computed views).
 */
export type Narrower<T, N> = ((state: T) => N) | { get: (state: T) => N; swap: (draft: Draft<T>, value: N) => void }

export const getterOf = <T, N>(narrow: Narrower<T, N>) => (typeof narrow === 'function' ? narrow : narrow.get)

const PATH = Symbol('path')
const untraceable = () =>
  new Error(
    'narrow: could not trace narrowFn to a node inside the state (it returned a copy/computed value, ' +
      'or used an identity comparison or Map lookup). Pass { get, swap } instead.',
  )

/** Run `narrowFn` against a proxy that records the keys it reads; return the path to the node it picked. */
function pathOf(state: object, narrowFn: (state: any) => unknown): PropertyKey[] {
  // Proxies a stand-in rather than `v` itself: proxy invariants forbid returning
  // wrapped values for frozen properties, so a proxy of `v` breaks on frozen state.
  const track = (v: unknown, path: PropertyKey[]): unknown => {
    if (v === null || typeof v !== 'object') return v
    const isArray = Array.isArray(v)
    return new Proxy(isArray ? [] : {}, {
      get: (_, k) => {
        if (k === PATH) return path
        // A getter's result isn't stored at that key, so writing there would do nothing: leave it untracked.
        if (Reflect.getOwnPropertyDescriptor(v, k)?.get) return Reflect.get(v, k)
        return track(Reflect.get(v, k), [...path, k])
      },
      has: (_, k) => k in v,
      ownKeys: () => Reflect.ownKeys(v),
      getPrototypeOf: () => Object.getPrototypeOf(v),
      getOwnPropertyDescriptor: (_, k) => {
        // An array stand-in's own `length` is non-configurable, so report it as such.
        if (isArray && k === 'length') return { value: (v as unknown[]).length, writable: true, enumerable: false, configurable: false }
        const d = Reflect.getOwnPropertyDescriptor(v, k)
        return d && { ...d, configurable: true }
      },
    })
  }
  let node: any
  try {
    node = narrowFn(track(state, []))
  } catch {
    throw untraceable()
  }
  const path = node?.[PATH]
  if (!path) throw untraceable()
  return path
}

const getAt = (v: any, path: PropertyKey[]) => path.reduce((o, k) => o[k], v)

/**
 * Turn a parent setter into a setter for the node `narrow` picks out of the
 * parent state. Writes to a node that no longer exists are no-ops.
 */
export function narrowSetter<T extends Container, N extends Container>(
  parentSet: SetStore<T>,
  narrow: Narrower<T, N>,
): SetStore<N> {
  const get = getterOf(narrow)
  const set = (next: unknown, mode?: 'mutate' | 'swap') => {
    mode ??= typeof next === 'function' ? 'mutate' : 'swap'
    parentSet((current: T) => {
      const node = get(current)
      // The node is gone (e.g. a list item was deleted before an async handler wrote to it).
      // Deliberately a silent no-op, not a throw or warning: these writes come from correct code,
      // and React removed its equivalent "update on an unmounted component" warning for the same reason.
      if (node == null) return current
      const value =
        mode === 'mutate'
          ? create(node, (d) => void (next as (d: unknown) => unknown)(d))
          : typeof next === 'function' ? next(node) : next
      if (value === node) return current
      if (typeof narrow !== 'function') return create(current, (d) => void narrow.swap(d, value))
      const path = pathOf(current, narrow)
      if (!path.length) return value
      return create(current, (d: any) => void (getAt(d, path.slice(0, -1))[path.at(-1)!] = value))
    }, 'swap')
  }
  return set as SetStore<N>
}
