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
import {
  type ActionState,
  type ActionTree,
  bindActions,
  type BoundActions,
  type BoundLevelOf,
  type BoundState,
  isActionSet,
  readLevel,
  type RootActions,
  sameLevel,
} from './actions.js'
import { applyUpdate, getterOf, narrowSetter, type Narrower, type SetStore } from './store.js'

/**
 * Like `useState`, but a function passed to the setter mutates a draft.
 *
 * With an action set from `defineActions`, returns the set's actions bound to the store instead of a setter, so
 * they're the only way to write. The state type then comes from the set, and `initial` is checked against it.
 */
export function useNewStore<T extends object>(initial: T | (() => T)): [T, SetStore<T>]
export function useNewStore<L extends RootActions>(
  initial: NoInfer<ActionState<L>> | (() => NoInfer<ActionState<L>>),
  actions: L,
): [ActionState<L>, BoundActions<L>]
export function useNewStore(initial: any, actions?: RootActions): [any, any] {
  const [state, setState] = useState(initial)
  const [set] = useState(() => ((next: unknown, mode?: 'mutate' | 'swap') => setState((prev: object) => applyUpdate(prev, next, mode))) as SetStore<object>)
  const bound = useMemo(() => actions && bindActions(set, actions as ActionTree<object, unknown, unknown>), [set, actions])
  return [state, bound ?? set]
}

/**
 * Narrows a store to the part `narrow` picks, returning that part and a setter that writes back into the store.
 *
 * For an action store, pick a level from its actions instead, like `useNarrowedStore(app, (a) => a.todo(id),
 * appActions)`: it returns that level's value and its actions, both from the one pick, so they can't disagree. The
 * level keeps its identity across renders while it leads to the same place.
 */
export function useNarrowedStore<T extends object, N extends object>(store: T, narrow: Narrower<T, N>, setStore: SetStore<T>): [N, SetStore<N>]
export function useNarrowedStore<T extends object, B extends object, L extends object>(
  store: T,
  pick: (actions: B) => L,
  actions: B,
): [BoundState<L>, L]
export function useNarrowedStore(store: object, narrow: any, setStoreOrActions: any): [any, any] {
  const isActions = typeof setStoreOrActions !== 'function'
  const set = useMemo(() => (isActions ? undefined : narrowSetter(setStoreOrActions, narrow)), [isActions, setStoreOrActions, narrow])
  // A new level each render, but the one already held is kept while it leads to the same place.
  const picked: object | undefined = isActions ? narrow(setStoreOrActions) : undefined
  const [held, setHeld] = useState(picked)
  let level = held
  if (picked && (!held || !sameLevel(held, picked))) {
    setHeld(picked)
    level = picked
  }
  const value = isActions ? readLevel(setStoreOrActions, store, level!) : getterOf(narrow)(store)
  if (value == null) throw new Error('react-narrow: the narrowed node is missing (narrow returned null/undefined)')
  return [value, isActions ? level : set]
}

type RenderItem<T extends object, K> = (item: T, setItem: SetStore<T>, key: K) => ReactNode

type ArrayItems<T extends object, K> = { items: T[]; getKey: (item: T, index: number) => K }
type KeyedItems<I> = { items: I; getKey?: undefined }
type WithSetter<T extends object, K, I extends object> = { setStore: SetStore<I>; actions?: undefined; children: RenderItem<T, K> }
// `actions` picks an item's level from an action set by its key, like `appActions.todo`.
type WithActions<T extends object, K, B> = {
  setStore?: undefined
  actions: (key: K) => B
  children: (item: T, actions: B, key: K) => ReactNode
}

interface NarrowListComponent {
  <T extends object>(props: ArrayItems<T, Key> & WithSetter<T, Key, T[]>): ReactNode
  <K extends string, T extends object>(props: KeyedItems<Record<K, T>> & WithSetter<T, K, Record<K, T>>): ReactNode
  <K extends Key, T extends object>(props: KeyedItems<Map<K, T>> & WithSetter<T, K, Map<K, T>>): ReactNode
  <T extends object, K extends Key, B extends BoundLevelOf<T>>(props: ArrayItems<T, K> & WithActions<T, K, B>): ReactNode
  <K extends string, T extends object, B extends BoundLevelOf<T>>(props: KeyedItems<Record<K, T>> & WithActions<T, K, B>): ReactNode
  <K extends Key, T extends object, B extends BoundLevelOf<T>>(props: KeyedItems<Map<K, T>> & WithActions<T, K, B>): ReactNode
  <T extends object, K extends Key>(props: ArrayItems<T, K> & ReadOnly<T, K>): ReactNode
  <K extends string, T extends object>(props: KeyedItems<Record<K, T>> & ReadOnly<T, K>): ReactNode
  <K extends Key, T extends object>(props: KeyedItems<Map<K, T>> & ReadOnly<T, K>): ReactNode
}

// Neither: each item is only memoized, for a list whose items have no writes of their own.
type ReadOnly<T extends object, K> = { setStore?: undefined; actions?: undefined; children: (item: T, key: K) => ReactNode }

// What NarrowList calls `children` with: the item, then its setter or its level's actions, then its key.
type AnyRender = (item: object, setItemOrActions: any, key: Key) => ReactNode

/**
 * Renders every item of an array, record or Map with its own narrowed store; only changed items re-render.
 * For an action store, pass `actions` (a level that takes the item's key) instead of `setStore`, and each item
 * gets its level's actions. With neither, each item is only memoized: `children` gets the item and its key.
 */
function NarrowListImpl({ items, setStore, getKey, actions, children }: {
  items: object[] | Record<string, object> | Map<Key, object>
  setStore?: SetStore<any>
  getKey?: (item: object, index: number) => Key
  actions?: (key: Key) => object
  children: AnyRender
}) {
  // Its JSX is only in a callback, so the compiler doesn't infer that it's a component on its own.
  'use memo'
  const kind = Array.isArray(items) ? 'array' : items instanceof Map ? 'map' : 'record'
  const entries: [Key, object][] = Array.isArray(items)
    ? items.map((item, i) => [getKey!(item, i), item])
    : items instanceof Map
      ? [...items]
      : Object.entries(items)
  return entries.map(([key, item]) =>
    setStore ? (
      <NarrowListItem key={key} itemKey={key} item={item} kind={kind} setStore={setStore} getKey={getKey} render={children} />
    ) : (
      <MemoListItem key={key} itemKey={key} item={item} level={actions} render={children} />
    ),
  )
}

export const NarrowList = memo(NarrowListImpl) as NarrowListComponent

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
  render: AnyRender
}) {
  const { itemKey, item, kind, setStore, getKey, render } = props
  const setItem = useMemo(() => narrowSetter(setStore, narrowToItem(kind, itemKey, getKey)), [setStore, kind, getKey, itemKey])
  return render(item, setItem, itemKey)
})

// Like NarrowListItem's setter, the item's actions are memoized here, so they keep their identity across renders.
const MemoListItem = memo(function MemoListItem(props: { itemKey: Key; item: object; level?: (key: Key) => object; render: AnyRender }) {
  const { item, level, itemKey, render } = props
  const actions = useMemo(() => level?.(itemKey), [level, itemKey])
  return actions ? render(item, actions, itemKey) : (render as unknown as (item: object, key: Key) => ReactNode)(item, itemKey)
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
  throw new Error('react-narrow: no store in context; the default value is read-only')
}) as SetStore<any>

// Separate value and setter contexts, so setter-only consumers don't re-render.
function makeContext<T extends object>(fallback?: T) {
  const ValueCtx = createContext<T | typeof NONE>(NONE)
  const SetCtx = createContext<SetStore<T> | typeof NONE>(NONE)
  const missing = () => new Error('react-narrow: no store found in context and no default was given')

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

/**
 * Creates a context store. `fallback` is a read-only value used when no Provider is above.
 *
 * With an action set from `defineActions`, its consumers get `useActions()` instead of `useSet()`.
 */
export function createContextStore<L extends RootActions>(actions: L): ActionStoreContext<ActionState<L>, BoundActions<L>>
export function createContextStore<T extends object>(fallback?: T): StoreContext<T>
export function createContextStore<T extends object>(fallbackOrActions?: T): unknown {
  if (isActionSet(fallbackOrActions)) return createActionContext(fallbackOrActions as unknown as RootActions)
  const fallback = fallbackOrActions
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

type NarrowedProvider<A> = {
  Provider(props: { children?: ReactNode } & ([A] extends [void] ? { narrowArg?: undefined } : { narrowArg: A })): ReactNode
}

/**
 * Creates a context store narrowed from `parent`, whose consumers only re-render when their part changes.
 *
 * For an action store, pick a level from the parent's actions instead, like `(appActions, id: string) => appActions.todo(id)`.
 */
export function createNarrowedStoreContext<T, B extends object, N extends object, A = void>(
  parent: ActionContextStore<T, B>,
  pick: (actions: B, arg: A) => N,
): ActionContextStore<BoundState<N>, N> & NarrowedProvider<A>
export function createNarrowedStoreContext<T extends object, N extends object, A = void>(
  parent: ContextStore<T>,
  narrow: ((state: T, arg: A) => N | undefined) | { get: (state: T, arg: A) => N | undefined; swap: (draft: Draft<T>, value: N, arg: A) => void },
  fallback?: N,
): ContextStore<N> & NarrowedProvider<A>
export function createNarrowedStoreContext<T extends object, N extends object, A = void>(
  parent: ContextStore<T> | ActionContextStore<T, object>,
  narrow: any,
  fallback?: N,
): unknown {
  if ('useActions' in parent) return narrowActionContext(parent, narrow)
  const { useVal, useSet } = parent
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
    const [value, set] = useNarrowedStore(useVal(), narrowed, useSet())
    return <Provide value={value} set={set}>{props.children}</Provide>
  }
  return { ...def, Provider }
}

/** An action store shared through context: `useVal()` re-renders on changes, `useActions()` never does. */
export interface ActionContextStore<T, B> {
  useVal(): T
  useActions(): B
}

type ActionProviderProps<T, B> =
  | { store: T; actions: B; initial?: never; children?: ReactNode }
  | { initial: T | (() => T); store?: never; actions?: never; children?: ReactNode }

export interface ActionStoreContext<T, B> extends ActionContextStore<T, B> {
  /** Owns a new store made from `initial`, or shares one from `useNewStore` as `store` and `actions`. */
  Provider(props: ActionProviderProps<T, B>): ReactNode
}

function makeActionContext<T, B>() {
  const ValueCtx = createContext<T | typeof NONE>(NONE)
  const ActionsCtx = createContext<B | typeof NONE>(NONE)
  const read = <V,>(v: V | typeof NONE) => {
    if (v === NONE) throw new Error('react-narrow: no action store found in context')
    return v
  }
  const def: ActionContextStore<T, B> = {
    useVal: () => read(useContext(ValueCtx)),
    useActions: () => read(useContext(ActionsCtx)),
  }
  const Provide = (p: { value: T; actions: B; children?: ReactNode }) => (
    <ValueCtx value={p.value}>
      <ActionsCtx value={p.actions}>{p.children}</ActionsCtx>
    </ValueCtx>
  )
  return { def, Provide }
}

function createActionContext<L extends RootActions>(actions: L): ActionStoreContext<ActionState<L>, BoundActions<L>> {
  const { def, Provide } = makeActionContext<ActionState<L>, BoundActions<L>>()
  function Owned(p: { initial: ActionState<L> | (() => ActionState<L>); children?: ReactNode }) {
    const [value, bound] = useNewStore(p.initial, actions)
    return <Provide value={value} actions={bound}>{p.children}</Provide>
  }
  function Provider({ store, actions: bound, initial, children }: ActionProviderProps<ActionState<L>, BoundActions<L>>) {
    if (initial !== undefined) return <Owned initial={initial}>{children}</Owned>
    return <Provide value={store!} actions={bound!}>{children}</Provide>
  }
  return { ...def, Provider }
}

function narrowActionContext<T, B extends object, N extends object, A>(
  parent: ActionContextStore<T, B>,
  pick: (actions: B, arg: A) => N,
): ActionContextStore<BoundState<N>, N> & NarrowedProvider<A> {
  const { useVal, useActions } = parent
  const { def, Provide } = makeActionContext<BoundState<N>, N>()
  function Provider(props: { children?: ReactNode; narrowArg?: A }) {
    const arg = props.narrowArg as A
    const [value, level] = useNarrowedStore(useVal() as object, (actions: B) => pick(actions, arg), useActions())
    return <Provide value={value} actions={level}>{props.children}</Provide>
  }
  return { ...def, Provider }
}
