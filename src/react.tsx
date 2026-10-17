import {
  createContext,
  type DependencyList,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { Draft } from 'mutative'
import { createStore, getterOf, narrowSetter, type Container, type Narrower, type SetStore } from './store'

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
 * Pass the parent's setter to get a narrowed setter. Leave it out and the
 * result is read-only: `[value]`.
 *
 * The setter is rebuilt when `setStore` or `narrow` changes, so it is always
 * correct, and stable whenever `narrow` is (hoisted, `useCallback`, or an inline
 * function under the React Compiler). Pass `deps` to key it on those instead,
 * like `useMemo`: then list every outside value `narrow` reads, e.g. an index.
 */
export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrow: Narrower<T, N>,
): [N]
export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrow: Narrower<T, N>,
  setStore: SetStore<T>,
  deps?: DependencyList,
): [N, SetStore<N>]
export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrow: Narrower<T, N>,
  setStore?: SetStore<T>,
  deps?: DependencyList,
): [N] | [N, SetStore<N>] {
  const set = useMemo(() => setStore && narrowSetter(setStore, narrow), deps ? [setStore, ...deps] : [setStore, narrow])
  const value = getterOf(narrow)(store)
  // With top-down rendering a removed node's component unmounts in the same pass,
  // so reaching this means something still renders a node that no longer exists.
  if (value == null) throw new Error('narrow: the narrowed node is missing (narrow returned null/undefined)')
  return set ? [value, set] : [value]
}

type NarrowProps<T extends Container, N extends Container> = { store: T; by: Narrower<T, N> }

/**
 * Narrow in JSX; same rules as `useNarrowedStore` (no `setStore` = read-only).
 *
 *   <Narrow store={store} setStore={setStore} by={(s) => s.todos[i]!} deps={[i]}>
 *     {(todo, setTodo) => <Todo todo={todo} onToggle={() => setTodo((t) => { t.done = !t.done })} />}
 *   </Narrow>
 */
export function Narrow<T extends Container, N extends Container>(
  props: NarrowProps<T, N> & { setStore: SetStore<T>; deps?: DependencyList; children: (value: N, set: SetStore<N>) => ReactNode },
): ReactNode
export function Narrow<T extends Container, N extends Container>(
  props: NarrowProps<T, N> & { setStore?: undefined; children: (value: N) => ReactNode },
): ReactNode
export function Narrow(props: any) {
  const [value, set] = (useNarrowedStore as any)(props.store, props.by, props.setStore, props.deps)
  return <>{props.children(value, set)}</>
}

export interface ContextStore<T extends Container> {
  /** The current value; re-renders on change. */
  use(): T
  /** Stable setter; never re-renders the caller. Throws when called if only a default is available. */
  useSet(): SetStore<T>
}

export interface StoreContext<T extends Container> extends ContextStore<T> {
  /** Provide a store from `useNewStore`, or have the provider own a new one via `initial`. */
  Provider(
    props:
      | { store: T; setStore: SetStore<T>; children?: ReactNode }
      | { initial: T | (() => T); children?: ReactNode },
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
    use() {
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

/** `fallback` is a read-only value returned by `use()` when no Provider is above. */
export function createContextStore<T extends Container>(fallback?: T): StoreContext<T> {
  const { def, Provide } = makeContext<T>(fallback)
  function Owned(p: { initial: T | (() => T); children?: ReactNode }) {
    const [value, set] = useNewStore(p.initial)
    return <Provide value={value} set={set}>{p.children}</Provide>
  }
  function Provider(
    props:
      | { store: T; setStore: SetStore<T>; children?: ReactNode }
      | { initial: T | (() => T); children?: ReactNode },
  ) {
    return 'store' in props ? (
      <Provide value={props.store} set={props.setStore}>{props.children}</Provide>
    ) : (
      <Owned initial={props.initial}>{props.children}</Owned>
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
    const [value, set] = useNarrowedStore(parent.use(), narrowed, parent.useSet(), [arg])
    return <Provide value={value} set={set}>{props.children}</Provide>
  }
  return { ...def, Provider }
}
