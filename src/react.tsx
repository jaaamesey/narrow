import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createStore, narrowStore, storeOf, type Container, type SetStore, type Store } from './store'

const read = <T,>(store: Store<any>, select?: (s: any) => T) => {
  const get = () => (select ? select(store.get()) : store.get())
  return useSyncExternalStore(store.subscribe, get, get)
}

/** Like `useState`: the value re-renders the owner; the setter is stable. */
export function useNewStore<T extends Container>(initial: T | (() => T)): [T, SetStore<T>] {
  const [store] = useState(() => createStore(typeof initial === 'function' ? initial() : initial))
  return [read(store), store.set]
}

/**
 * Re-render only when `selector(store)` changes (by `Object.is`, so return
 * stable references). `store` is any value from this library.
 */
export function useSelector<T extends Container, S>(store: T, selector: (state: T) => S): S {
  return read(storeOf(store), selector)
}

/** One narrowed store per parent, always calling the latest `narrowFn` (so inline fns are fine). */
function useNarrowedCore<T extends Container, N extends Container>(parent: Store<T>, narrowFn: (s: T) => N) {
  const fn = useRef(narrowFn)
  fn.current = narrowFn
  return useMemo(() => narrowStore(parent, (s) => fn.current(s)), [parent])
}

/**
 * Narrow `store` to the object/array `narrowFn` returns. `narrowFn` may be
 * an inline function; the returned setter is stable.
 */
export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrowFn: (state: T) => N,
): [N, SetStore<N>] {
  const narrowed = useNarrowedCore(storeOf(store), narrowFn)
  return [read(narrowed), narrowed.set]
}

/**
 * Narrow in JSX. The render function gets the narrowed value and its setter.
 *
 *   <Narrow store={store} by={(s) => s.todos[i]!}>
 *     {(todo, setTodo) => <Todo todo={todo} onToggle={() => setTodo((t) => { t.done = !t.done })} />}
 *   </Narrow>
 */
export function Narrow<T extends Container, N extends Container>(props: {
  store: T
  by: (state: T) => N
  children: (value: N, set: SetStore<N>) => ReactNode
}) {
  const [value, set] = useNarrowedStore(props.store, props.by)
  return <>{props.children(value, set)}</>
}

export interface ContextStore<T extends Container> {
  /** The current value; re-renders on change. */
  use(): T
  /** Stable setter; never re-renders the caller. */
  useSet(): SetStore<T>
  /** @internal The underlying store (used to chain narrowed contexts). */
  useCore(): Store<T>
}

export interface StoreContext<T extends Container> extends ContextStore<T> {
  /** Provide a store value from `useNewStore`/another context, or own a new one via `initial`. */
  Provider(props: { store: T; children?: ReactNode } | { initial: T | (() => T); children?: ReactNode }): ReactNode
}

function makeContext<T extends Container>(fallback?: T) {
  const Ctx = createContext<Store<T> | null>(null)
  let fallbackStore: Store<T> | undefined

  const useCore = () => {
    const found = useContext(Ctx)
    if (found) return found
    if (fallback === undefined) throw new Error('narrow: no store found in context and no default was given')
    return (fallbackStore ??= createStore(fallback))
  }
  const def: ContextStore<T> = {
    useCore,
    use: () => read(useCore()),
    useSet: () => useCore().set,
  }
  return { Ctx, def }
}

/** `fallback` is used (as one shared store) when no provider is above. */
export function createContextStore<T extends Container>(fallback?: T): StoreContext<T> {
  const { Ctx, def } = makeContext<T>(fallback)
  function Owned(p: { initial: T | (() => T); children?: ReactNode }) {
    const [store] = useState(() => createStore(typeof p.initial === 'function' ? p.initial() : p.initial))
    return <Ctx value={store}>{p.children}</Ctx>
  }
  function Provider(props: { store: T; children?: ReactNode } | { initial: T | (() => T); children?: ReactNode }) {
    return 'store' in props ? <Ctx value={storeOf(props.store)}>{props.children}</Ctx> : <Owned initial={props.initial}>{props.children}</Owned>
  }
  return { ...def, Provider }
}

/**
 * A context whose store is a narrowed view of another context's store
 * (which can itself be narrowed). `narrowFn` receives the parent state and
 * the `arg` prop given to the Provider, e.g. a list index:
 *
 *   const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s[i]!)
 *   <todoDef.Provider arg={i}><TodoRow /></todoDef.Provider>
 */
export function createNarrowedStoreContext<T extends Container, N extends Container, A = void>(
  parent: ContextStore<T>,
  narrowFn: (state: T, arg: A) => N,
  fallback?: N,
): ContextStore<N> & {
  Provider(props: { children?: ReactNode } & ([A] extends [void] ? { arg?: undefined } : { arg: A })): ReactNode
} {
  const { Ctx, def } = makeContext<N>(fallback)
  function Provider(props: { children?: ReactNode; arg?: A }) {
    const arg = props.arg as A
    return <Ctx value={useNarrowedCore(parent.useCore(), (s: T) => narrowFn(s, arg))}>{props.children}</Ctx>
  }
  return { ...def, Provider }
}
