import { create, type Draft } from 'mutative'

export type Container = object

type Primitive = string | number | boolean | bigint | symbol | null | undefined

// Primitives are allowed so `s => (s.a = 1)` compiles; an object is a forgotten 'swap'.
type MutateResult<R> = [R] extends [void | Primitive]
  ? R
  : 'recipe returned an object: it mutates by default. Pass "swap" as the second argument to replace the state'

export interface SetStore<T extends Container> {
  (next: T): void
  <R>(recipe: (draft: Draft<T>) => MutateResult<R>, mode?: 'mutate'): void
  (recipe: (current: T) => T, mode: 'swap'): void
}

export function applyUpdate<T>(prev: T, next: unknown, mode?: 'mutate' | 'swap'): T {
  mode ??= typeof next === 'function' ? 'mutate' : 'swap'
  if (mode === 'swap') return (typeof next === 'function' ? next(prev) : next) as T
  return create(prev, (draft) => void (next as (d: Draft<T>) => unknown)(draft))
}

export type Narrower<T, N> = ((state: T) => N) | { get: (state: T) => N; swap: (draft: Draft<T>, value: N) => void }

export const getterOf = <T, N>(narrow: Narrower<T, N>) => (typeof narrow === 'function' ? narrow : narrow.get)

const PATH = Symbol('path')
const untraceable = () =>
  new Error(
    'narrow: could not trace narrowFn to a node inside the state (it returned a copy/computed value, ' +
      'or used an identity comparison or Map lookup). Pass { get, swap } instead.',
  )

// The path of keys narrowFn reads to reach the node it returns.
function pathOf(state: object, narrowFn: (state: any) => unknown): PropertyKey[] {
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

export function narrowSetter<T extends Container, N extends Container>(
  parentSet: SetStore<T>,
  narrow: Narrower<T, N>,
): SetStore<N> {
  const get = getterOf(narrow)
  const set = (next: unknown, mode?: 'mutate' | 'swap') => {
    mode ??= typeof next === 'function' ? 'mutate' : 'swap'
    parentSet((current: T) => {
      const node = get(current)
      // Deliberately silent: late async writes to deleted items are normal (React dropped its similar warning).
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
