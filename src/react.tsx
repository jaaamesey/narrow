import {
  createContext,
  memo,
  type Key,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Draft } from 'mutative'
import { applyUpdate, getterOf, narrowSetter, type Narrower, type SetStore } from './store.js'

/** Like `useState`, but a function passed to the setter mutates a draft. */
export function useNewStore<T extends object>(initial: T | (() => T)): [T, SetStore<T>] {
  const [state, setState] = useState(initial)
  const [set] = useState(() => ((next: unknown, mode?: 'mutate' | 'swap') => setState((prev) => applyUpdate(prev, next, mode))) as SetStore<T>)
  return [state, set]
}

/** Narrows a store to the part `narrow` picks, returning that part and a setter that writes back into the store. */
export function useNarrowedStore<T extends object, N extends object>(
  store: T,
  narrow: Narrower<T, N>,
  setStore: SetStore<T>,
): [N, SetStore<N>] {
  const set = useMemo(() => narrowSetter(setStore, narrow), [setStore, narrow])
  const value = getterOf(narrow)(store)
  if (value == null) throw new Error('narrow: the narrowed node is missing (narrow returned null/undefined)')
  return [value, set]
}

type RenderItem<T extends object, K> = (item: T, setItem: SetStore<T>, key: K) => ReactNode

/** Renders every item of an array with its own narrowed store; only changed items re-render. */
export function NarrowList<T extends object>(props: {
  items: T[]
  setStore: SetStore<T[]>
  getKey: (item: T, index: number) => Key
  children: RenderItem<T, Key>
}): ReactNode
/** Renders every entry of a record with its own narrowed store; only changed entries re-render. */
export function NarrowList<K extends string, T extends object>(props: {
  items: Record<K, T>
  setStore: SetStore<Record<K, T>>
  getKey?: never
  children: RenderItem<T, K>
}): ReactNode
/** Renders every entry of a Map with its own narrowed store; only changed entries re-render. */
export function NarrowList<K extends Key, T extends object>(props: {
  items: Map<K, T>
  setStore: SetStore<Map<K, T>>
  getKey?: never
  children: RenderItem<T, K>
}): ReactNode
export function NarrowList({ items, setStore, getKey, children }: {
  items: object[] | Record<string, object> | Map<Key, object>
  setStore: SetStore<any>
  getKey?: (item: object, index: number) => Key
  children: RenderItem<object, Key>
}) {
  const kind = Array.isArray(items) ? 'array' : items instanceof Map ? 'map' : 'record'
  const entries: [Key, object][] = Array.isArray(items)
    ? items.map((item, i) => [getKey!(item, i), item])
    : items instanceof Map
      ? [...items]
      : Object.entries(items)
  return entries.map(([key, item]) => (
    <NarrowListItem key={key} itemKey={key} item={item} kind={kind} setStore={setStore} getKey={getKey} render={children} />
  ))
}

type ItemKind = 'array' | 'record' | 'map'

const narrowToItem = (kind: ItemKind, key: Key, getKey?: (item: object, index: number) => Key): Narrower<any, object> =>
  kind === 'array'
    ? (items: object[]) => items.find((x, i) => getKey!(x, i) === key)
    : kind === 'map'
      ? { get: (m: Map<Key, object>) => m.get(key), swap: (d, v) => void d.set(key, v) }
      : (r: Record<string, object>) => r[String(key)]

const NarrowListItem = memo(function NarrowListItem(props: {
  itemKey: Key
  item: object
  kind: ItemKind
  setStore: SetStore<any>
  getKey?: (item: object, index: number) => Key
  render: RenderItem<object, Key>
}) {
  const { itemKey, item, kind, setStore, getKey, render } = props
  const setItem = useMemo(() => narrowSetter(setStore, narrowToItem(kind, itemKey, getKey)), [setStore, kind, getKey, itemKey])
  return render(item, setItem, itemKey)
})

/** A store shared through context: `useVal()` re-renders on changes, `useSet()` never does. */
export interface ContextStore<T extends object> {
  useVal(): T
  useSet(): SetStore<T>
}

type ProviderProps<T extends object> =
  | { store: T; setStore: SetStore<T>; initial?: never; children?: ReactNode }
  | { initial: T | (() => T); store?: never; setStore?: never; children?: ReactNode }

export interface StoreContext<T extends object> extends ContextStore<T> {
  Provider(props: ProviderProps<T>): ReactNode
}

const NONE = Symbol('no provider')

const readOnlyDefault = (() => {
  throw new Error('narrow: no store in context; the default value is read-only')
}) as SetStore<any>

// Separate value and setter contexts, so setter-only consumers don't re-render.
function makeContext<T extends object>(fallback?: T) {
  const ValueCtx = createContext<T | typeof NONE>(NONE)
  const SetCtx = createContext<SetStore<T> | typeof NONE>(NONE)
  const missing = () => new Error('narrow: no store found in context and no default was given')

  const def: ContextStore<T> = {
    useVal() {
      const value = useContext(ValueCtx)
      if (value !== NONE) return value
      if (fallback !== undefined) return fallback
      throw missing()
    },
    useSet() {
      const set = useContext(SetCtx)
      if (set !== NONE) return set
      if (fallback !== undefined) return readOnlyDefault
      throw missing()
    },
  }
  const Provide = (p: { value: T; set: SetStore<T>; children?: ReactNode }) => (
    <ValueCtx value={p.value}>
      <SetCtx value={p.set}>{p.children}</SetCtx>
    </ValueCtx>
  )
  return { def, Provide }
}

/** Creates a context store. `fallback` is a read-only value used when no Provider is above. */
export function createContextStore<T extends object>(fallback?: T): StoreContext<T> {
  const { def, Provide } = makeContext<T>(fallback)
  function Owned(p: { initial: T | (() => T); children?: ReactNode }) {
    const [value, set] = useNewStore(p.initial)
    return <Provide value={value} set={set}>{p.children}</Provide>
  }
  function Provider({ store, setStore, initial, children }: ProviderProps<T>) {
    if (initial !== undefined) return <Owned initial={initial}>{children}</Owned>
    return <Provide value={store!} set={setStore!}>{children}</Provide>
  }
  return { ...def, Provider }
}

/** Creates a context store narrowed from `parent`, whose consumers only re-render when their part changes. */
export function createNarrowedStoreContext<T extends object, N extends object, A = void>(
  parent: ContextStore<T>,
  narrow: ((state: T, arg: A) => N | undefined) | { get: (state: T, arg: A) => N | undefined; swap: (draft: Draft<T>, value: N, arg: A) => void },
  fallback?: N,
): ContextStore<N> & {
  Provider(props: { children?: ReactNode } & ([A] extends [void] ? { narrowArg?: undefined } : { narrowArg: A })): ReactNode
} {
  const { def, Provide } = makeContext<N>(fallback)
  function Provider(props: { children?: ReactNode; narrowArg?: A }) {
    const arg = props.narrowArg as A
    const narrowed = useMemo<Narrower<T, N>>(
      () =>
        typeof narrow === 'function'
          ? (s) => narrow(s, arg)
          : { get: (s) => narrow.get(s, arg), swap: (d, v) => narrow.swap(d, v, arg) },
      [arg],
    )
    const [value, set] = useNarrowedStore(parent.useVal(), narrowed, parent.useSet())
    return <Provide value={value} set={set}>{props.children}</Provide>
  }
  return { ...def, Provider }
}
