import { create, type Draft } from 'mutative'

type Primitive = string | number | boolean | bigint | symbol | null | undefined

// Primitives are allowed so `s => (s.a = 1)` compiles; an object is a forgotten 'swap'.
type MutateResult<R> = [R] extends [void | Primitive]
  ? R
  : 'recipe returned an object: it mutates by default. Pass "swap" as the second argument to replace the state'

/** Mutates a draft when given a function, replaces the state when given a value or a function with `'swap'`. */
export interface SetStore<T extends object> {
  (next: T): void
  <R>(recipe: (draft: Draft<T>) => MutateResult<R>, mode?: 'mutate'): void
  (recipe: (current: T) => T, mode: 'swap'): void
}

const modeOf = (next: unknown, mode?: 'mutate' | 'swap') => mode ?? (typeof next === 'function' ? 'mutate' : 'swap')

export function applyUpdate<T>(prev: T, next: unknown, mode?: 'mutate' | 'swap'): T {
  if (modeOf(next, mode) === 'swap') return (typeof next === 'function' ? next(prev) : next) as T
  return create(prev, (draft) => void (next as (d: Draft<T>) => unknown)(draft))
}

/** A narrow function, or `{ get, swap }` when the function can't be traced. */
export type Narrower<T, N> =
  | ((state: T) => N | undefined)
  | { get: (state: T) => N | undefined; swap: (draft: Draft<T>, value: N) => void }

export const getterOf = <T, N>(narrow: Narrower<T, N>) => (typeof narrow === 'function' ? narrow : narrow.get)

const PATH = Symbol('path')
const untraceable = (cause?: unknown) =>
  new Error(
    'react-narrow: could not trace narrowFn to a node inside the state (it returned a copy/computed value, ' +
      'or used an identity comparison or Map lookup). Pass { get, swap } instead.',
    { cause },
  )

// The path of keys narrowFn reads to reach the node it returns, or null if it returns nothing.
function pathOf(state: object, narrowFn: (state: any) => unknown): PropertyKey[] | null {
  // Proxy a stand-in, not `v`: proxy invariants forbid wrapping frozen properties.
  const track = (v: unknown, path: PropertyKey[]): unknown => {
    if (v === null || typeof v !== 'object') return v
    const isArray = Array.isArray(v)
    return new Proxy(isArray ? [] : {}, {
      get: (_, k) => {
        if (k === PATH) return path
        // A write to a getter would be lost, so don't trace through one.
        if (Reflect.getOwnPropertyDescriptor(v, k)?.get) return Reflect.get(v, k)
        return track(Reflect.get(v, k), [...path, k])
      },
      has: (_, k) => k in v,
      ownKeys: () => Reflect.ownKeys(v),
      getPrototypeOf: () => Object.getPrototypeOf(v),
      getOwnPropertyDescriptor: (_, k) => {
        // The stand-in array's own `length` is non-configurable.
        if (isArray && k === 'length') return { value: (v as unknown[]).length, writable: true, enumerable: false, configurable: false }
        const d = Reflect.getOwnPropertyDescriptor(v, k)
        return d && { ...d, configurable: true }
      },
    })
  }
  // On failure, rerun narrowFn on the real state: if it fails there too, that error is narrowFn's own bug.
  let node: any
  try {
    node = narrowFn(track(state, []))
  } catch (cause) {
    narrowFn(state)
    throw untraceable(cause)
  }
  if (node == null) {
    if (narrowFn(state) == null) return null
    throw untraceable()
  }
  const path = node[PATH]
  if (!path) throw untraceable()
  return path
}

const getAt = (v: any, path: PropertyKey[]) => path.reduce((o, k) => o[k], v)

export function narrowSetter<T extends object, N extends object>(
  parentSet: SetStore<T>,
  narrow: Narrower<T, N>,
): SetStore<N> {
  const set = (next: unknown, mode?: 'mutate' | 'swap') =>
    parentSet((current: T) => {
      if (typeof narrow !== 'function') {
        const node = narrow.get(current)
        // Deliberately silent: late async writes to deleted items are normal (React dropped its similar warning).
        if (node == null) return current
        const value = applyUpdate(node, next, mode)
        return value === node ? current : create(current, (d) => void narrow.swap(d, value))
      }
      const path = pathOf(current, narrow)
      if (!path) return current // see above
      if (modeOf(next, mode) === 'mutate') return create(current, (d) => void (next as (d: unknown) => unknown)(getAt(d, path)))
      const node = getAt(current, path)
      const value = typeof next === 'function' ? next(node) : next
      if (value === node) return current
      if (!path.length) return value
      return create(current, (d: any) => void (getAt(d, path.slice(0, -1))[path.at(-1)!] = value))
    }, 'swap')
  return set as SetStore<N>
}
