import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createStore, narrowStore, type Container, type SetStore, type Store } from './store'

/** Create a store owned by the calling component. Does not subscribe: read it with `useStoreValue`. */
export function useNewStore<T extends Container>(initial: T | (() => T)): [Store<T>, SetStore<T>] {
  const [store] = useState(() => createStore(typeof initial === 'function' ? initial() : initial))
  return [store, store.set]
}

/**
 * Subscribe to a store, optionally through a selector. Re-renders only when
 * the (selected) value changes by `Object.is`, so selectors must return
 * stable references.
 */
export function useStoreValue<T extends Container>(store: Store<T>): T
export function useStoreValue<T extends Container, S>(store: Store<T>, selector: (state: T) => S): S
export function useStoreValue(store: Store<any>, selector?: (state: any) => unknown) {
  const get = () => (selector ? selector(store.get()) : store.get())
  return useSyncExternalStore(store.subscribe, get, get)
}

/**
 * Narrow `store` to the object/array `narrowFn` returns. Memoized on
 * `[store, narrowFn]`, so wrap `narrowFn` in `useCallback` if you need the
 * narrowed store to keep its identity across renders.
 */
export function useNarrowedStore<T extends Container, N extends Container>(
  store: Store<T>,
  narrowFn: (state: T) => N,
): [Store<N>, SetStore<N>] {
  const narrowed = useMemo(() => narrowStore(store, narrowFn), [store, narrowFn])
  return [narrowed, narrowed.set]
}

/**
 * Narrow in JSX. Children get the narrowed value (re-rendered when it
 * changes), its setter, and the narrowed store itself (to pass further down).
 *
 *   <Narrow store={store} by={(s) => s.todos[i]!}>
 *     {(todo, setTodo) => <Todo todo={todo} onToggle={() => setTodo((t) => { t.done = !t.done })} />}
 *   </Narrow>
 */
export function Narrow<T extends Container, N extends Container>(props: {
  store: Store<T>
  by: (state: T) => N
  children: (value: N, set: SetStore<N>, store: Store<N>) => ReactNode
}) {
  const [narrowed, set] = useNarrowedStore(props.store, props.by)
  return <>{props.children(useStoreValue(narrowed), set, narrowed)}</>
}

export interface ContextStore<T extends Container> {
  /** The store's current value; re-renders on change. */
  use(): T
  /** Stable setter; never re-renders the caller. */
  useSet(): SetStore<T>
  /** The store handle itself (for narrowing or passing along); never re-renders. */
  useStore(): Store<T>
}

export interface StoreContext<T extends Container> extends ContextStore<T> {
  /** Provide an existing store, or have the provider own a new one from `initial`. */
  Provider(props: { store: Store<T>; children?: ReactNode } | { initial: T | (() => T); children?: ReactNode }): ReactNode
}

function makeContext<T extends Container>(fallback?: T) {
  const Ctx = createContext<Store<T> | null>(null)
  let fallbackStore: Store<T> | undefined

  const useStore = () => {
    const found = useContext(Ctx)
    if (found) return found
    if (fallback === undefined) throw new Error('narrow: no store found in context and no default was given')
    return (fallbackStore ??= createStore(fallback))
  }
  const def: ContextStore<T> = {
    useStore,
    use: () => useStoreValue(useStore()),
    useSet: () => useStore().set,
  }
  return { Ctx, def }
}

/** `fallback` is used (as one shared store) when no provider is above. */
export function createContextStore<T extends Container>(fallback?: T): StoreContext<T> {
  const { Ctx, def } = makeContext<T>(fallback)
  function Provider(props: { store: Store<T>; children?: ReactNode } | { initial: T | (() => T); children?: ReactNode }) {
    return 'store' in props ? (
      <Ctx value={props.store}>{props.children}</Ctx>
    ) : (
      <OwnedProvider Ctx={Ctx} initial={props.initial}>{props.children}</OwnedProvider>
    )
  }
  return { ...def, Provider }
}

function OwnedProvider<T extends Container>(p: { Ctx: React.Context<Store<T> | null>; initial: T | (() => T); children?: ReactNode }) {
  const [store] = useNewStore(p.initial)
  return <p.Ctx value={store}>{p.children}</p.Ctx>
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
    const fn = useMemo(() => (s: T) => narrowFn(s, arg), [arg])
    const [store] = useNarrowedStore(parent.useStore(), fn)
    return <Ctx value={store}>{props.children}</Ctx>
  }
  return { ...def, Provider }
}
