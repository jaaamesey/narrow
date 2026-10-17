import {
  createContext,
  memo,
  type DependencyList,
  type Key,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { Draft } from 'mutative'
import { createStore, getterOf, narrowSetter, type Container, type Narrower, type SetStore } from './store.js'

/** Like `useState`: the value re-renders the owner; the setter is stable. */
export function useNewStore<T extends Container>(initial: T | (() => T)): [T, SetStore<T>] {
  const [store] = useState(() => createStore(typeof initial === 'function' ? initial() : initial))
  return [useSyncExternalStore(store.subscribe, store.get, store.get), store.set]
}

/**
 * Narrow `store` to the object/array `narrow` picks: a function like
 * `(s) => s.todos[i]`, or `{ get, swap }` when the function can't be traced
 * (identity comparisons, Map entries, computed views).
 *
 * Returns the narrowed value and a setter that writes into the parent store.
 *
 * The setter is rebuilt when `setStore` or `narrow` changes, so it is always
 * correct, and stable whenever `narrow` is (hoisted, `useCallback`, or an inline
 * function under the React Compiler). Pass `deps` to key it on those instead,
 * like `useMemo`: then list every outside value `narrow` reads, e.g. an index.
 */
export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrow: Narrower<T, N>,
  setStore: SetStore<T>,
  deps?: DependencyList,
): [N, SetStore<N>] {
  const set = useMemo(() => narrowSetter(setStore, narrow), deps ? [setStore, ...deps] : [setStore, narrow])
  const value = getterOf(narrow)(store)
  // With top-down rendering a removed node's component unmounts in the same pass,
  // so reaching this means something still renders a node that no longer exists.
  if (value == null) throw new Error('narrow: the narrowed node is missing (narrow returned null/undefined)')
  return [value, set]
}

/**
 * Narrow every item of an array store and render `children` once per item.
 * Each item is its own memoized component with a stable setter (cached on the
 * item's key), so changing one item re-renders only that item, with no `deps`
 * or `memo` needed. This relies on `children` being stable, which the React
 * Compiler handles; without it, wrap `children` in `useCallback`.
 *
 * `items` are the items to render: the array `setStore` writes to, or any
 * subset of it (e.g. filtered), since each item's setter finds it by key.
 *
 * `getKey` doubles as the React key and is read once per item, like a key: it
 * should only read the item, e.g. `(t) => t.id`. For an inherently index-based
 * list, use `(_, i) => i`: each setter then targets whatever is at that index.
 *
 *   <NarrowList items={todos} setStore={setTodos} getKey={(t) => t.id}>
 *     {(todo, setTodo) => <TodoItem todo={todo} setTodo={setTodo} />}
 *   </NarrowList>
 */
export function NarrowList<T extends Container, K extends Key>(props: {
  items: T[]
  setStore: SetStore<T[]>
  getKey: (item: T, index: number) => K
  children: (item: T, setItem: SetStore<T>) => ReactNode
}) {
  return props.items.map((item, index) => {
    const key = props.getKey(item, index)
    return (
      <NarrowListItem
        key={key}
        itemKey={key}
        item={item}
        setStore={props.setStore}
        getKey={props.getKey}
        render={props.children}
      />
    )
  })
}

type NarrowListItemProps = {
  itemKey: Key
  item: any
  setStore: SetStore<any[]>
  getKey: (item: any, index: number) => Key
  render: (item: any, setItem: SetStore<any>) => ReactNode
}

const NarrowListItem = memo(
  function NarrowListItem({ itemKey, item, setStore, getKey, render }: NarrowListItemProps) {
    // Cached on the key, not on `getKey`, so an inline `getKey` doesn't rebuild it.
    const setItem = useMemo(
      () => narrowSetter(setStore, (items: any[]) => items.find((x, i) => getKey(x, i) === itemKey)),
      [setStore, itemKey],
    )
    return render(item, setItem)
  },
  // `getKey` is ignored for the same reason; unchanged items keep their identity
  // thanks to structural sharing, so `item` is all that changes for an edit.
  (a, b) => a.item === b.item && a.itemKey === b.itemKey && a.setStore === b.setStore && a.render === b.render,
)

export interface ContextStore<T extends Container> {
  /** The current value; re-renders on change. */
  useVal(): T
  /** Stable setter; never re-renders the caller. Throws when called if only a default is available. */
  useSet(): SetStore<T>
}

export interface StoreContext<T extends Container> extends ContextStore<T> {
  /** Provide a store from `useNewStore`, or have the provider own a new one via `initial`. */
  Provider(
    props:
      | { store: T; setStore: SetStore<T>; initial?: never; children?: ReactNode }
      | { initial: T | (() => T); store?: never; setStore?: never; children?: ReactNode },
  ): ReactNode
}

const NONE = Symbol('no provider')

const readOnlyDefault = (() => {
  throw new Error('narrow: no store in context; the default value is read-only')
}) as SetStore<any>

/**
 * Value and setter live in separate contexts so setter-only consumers never
 * re-render. Like React's `createContext(default)`, `fallback` is a plain
 * read-only value used when no Provider is above.
 */
function makeContext<T extends Container>(fallback?: T) {
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

/** `fallback` is a read-only value returned by `useVal()` when no Provider is above. */
export function createContextStore<T extends Container>(fallback?: T): StoreContext<T> {
  const { def, Provide } = makeContext<T>(fallback)
  function Owned(p: { initial: T | (() => T); children?: ReactNode }) {
    const [value, set] = useNewStore(p.initial)
    return <Provide value={value} set={set}>{p.children}</Provide>
  }
  function Provider(
    props:
      | { store: T; setStore: SetStore<T>; initial?: never; children?: ReactNode }
      | { initial: T | (() => T); store?: never; setStore?: never; children?: ReactNode },
  ) {
    // The props types make these mutually exclusive (`never` on the other branch).
    return props.setStore ? (
      <Provide value={props.store as T} set={props.setStore}>{props.children}</Provide>
    ) : (
      <Owned initial={props.initial!}>{props.children}</Owned>
    )
  }
  return { ...def, Provider }
}

/**
 * A context that is a narrowed view of another context (which can itself be
 * narrowed). `narrow` (a function or `{ get, swap }`) receives the `narrowArg` prop given
 * to the Provider as its second parameter, e.g. a list index. The setter follows
 * `narrowArg` changes, compared with `Object.is` like a dependency, so prefer
 * primitives (an id or index) over object literals.
 *
 *   const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!)
 *   <todoDef.Provider narrowArg={i}><TodoRow /></todoDef.Provider>
 */
export function createNarrowedStoreContext<T extends Container, N extends Container, A = void>(
  parent: ContextStore<T>,
  narrow: ((state: T, arg: A) => N) | { get: (state: T, arg: A) => N; swap: (draft: Draft<T>, value: N, arg: A) => void },
  fallback?: N,
): ContextStore<N> & {
  Provider(props: { children?: ReactNode } & ([A] extends [void] ? { narrowArg?: undefined } : { narrowArg: A })): ReactNode
} {
  const { def, Provide } = makeContext<N>(fallback)
  function Provider(props: { children?: ReactNode; narrowArg?: A }) {
    const arg = props.narrowArg as A
    const narrowed: Narrower<T, N> =
      typeof narrow === 'function'
        ? (s) => narrow(s, arg)
        : { get: (s) => narrow.get(s, arg), swap: (d, v) => narrow.swap(d, v, arg) }
    const [value, set] = useNarrowedStore(parent.useVal(), narrowed, parent.useSet(), [arg])
    return <Provide value={value} set={set}>{props.children}</Provide>
  }
  return { ...def, Provider }
}
