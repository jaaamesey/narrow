import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createStore, narrowSetter, type Container, type SetStore, type Store } from './store'

/** Like `useState`: the value re-renders the owner; the setter is stable. */
export function useNewStore<T extends Container>(initial: T | (() => T)): [T, SetStore<T>] {
  const [store] = useState(() => createStore(typeof initial === 'function' ? initial() : initial))
  return [useSyncExternalStore(store.subscribe, store.get, store.get), store.set]
}

/**
 * Narrow `store` to the object/array `narrowFn` returns.
 *
 * Pass the parent's setter to get a (stable) narrowed setter. Leave it out
 * and the result is read-only: `[value]`.
 *
 * `narrowFn` and `setStore` are read once, on mount, and must not change for
 * the life of the component. If the target depends on a prop (an id or index),
 * give the component a `key` so it remounts when that changes.
 */
export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrowFn: (state: T) => N,
): [N]
export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrowFn: (state: T) => N,
  setStore: SetStore<T>,
): [N, SetStore<N>]
export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrowFn: (state: T) => N,
  setStore?: SetStore<T>,
): [N] | [N, SetStore<N>] {
  const [narrowed] = useState(() => ({ fn: narrowFn, set: setStore && narrowSetter(setStore, narrowFn) }))
  const value = narrowed.fn(store)
  return narrowed.set ? [value, narrowed.set] : [value]
}

type NarrowProps<T extends Container, N extends Container> = { store: T; by: (state: T) => N }

/**
 * Narrow in JSX; same rules as `useNarrowedStore` (no `setStore` = read-only).
 *
 *   <Narrow store={store} setStore={setStore} by={(s) => s.todos[i]!}>
 *     {(todo, setTodo) => <Todo todo={todo} onToggle={() => setTodo((t) => { t.done = !t.done })} />}
 *   </Narrow>
 */
export function Narrow<T extends Container, N extends Container>(
  props: NarrowProps<T, N> & { setStore: SetStore<T>; children: (value: N, set: SetStore<N>) => ReactNode },
): ReactNode
export function Narrow<T extends Container, N extends Container>(
  props: NarrowProps<T, N> & { setStore?: undefined; children: (value: N) => ReactNode },
): ReactNode
export function Narrow(props: any) {
  const [value, set] = (useNarrowedStore as any)(props.store, props.by, props.setStore)
  return <>{props.children(value, set)}</>
}

export interface ContextStore<T extends Container> {
  /** The current value; re-renders on change. */
  use(): T
  /** Stable setter; never re-renders the caller. */
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

/** Value and setter live in separate contexts so setter-only consumers never re-render. */
function makeContext<T extends Container>(fallback?: T) {
  const ValueCtx = createContext<T | typeof NONE>(NONE)
  const SetCtx = createContext<SetStore<T> | typeof NONE>(NONE)
  let fb: Store<T> | undefined
  const fallbackStore = () => (fb ??= createStore(fallback!))
  const missing = () => new Error('narrow: no store found in context and no default was given')

  const def: ContextStore<T> = {
    use() {
      const value = useContext(ValueCtx)
      // Subscribing is unconditional (hooks), but only to the default store, and only if one exists.
      const s = fallback !== undefined ? fallbackStore() : undefined
      const dflt = useSyncExternalStore(s?.subscribe ?? noopSubscribe, s?.get ?? noopGet, s?.get ?? noopGet)
      if (value !== NONE) return value
      if (s) return dflt as T
      throw missing()
    },
    useSet() {
      const set = useContext(SetCtx)
      if (set !== NONE) return set
      if (fallback !== undefined) return fallbackStore().set
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
const noopSubscribe = () => () => {}
const noopGet = () => undefined

/** `fallback` is used (as one shared store) when no provider is above. */
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
 * narrowed). `narrowFn` receives the parent state and the `arg` prop given to
 * the Provider, e.g. a list index. `arg` is read once: to change it, remount
 * the Provider with a `key`.
 *
 *   const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!)
 *   <todoDef.Provider arg={i}><TodoRow /></todoDef.Provider>
 */
export function createNarrowedStoreContext<T extends Container, N extends Container, A = void>(
  parent: ContextStore<T>,
  narrowFn: (state: T, arg: A) => N,
  fallback?: N,
): ContextStore<N> & {
  Provider(props: { children?: ReactNode } & ([A] extends [void] ? { arg?: undefined } : { arg: A })): ReactNode
} {
  const { def, Provide } = makeContext<N>(fallback)
  function Provider(props: { children?: ReactNode; arg?: A }) {
    const [value, set] = useNarrowedStore(parent.use(), (s) => narrowFn(s, props.arg as A), parent.useSet())
    return <Provide value={value} set={set}>{props.children}</Provide>
  }
  return { ...def, Provider }
}
