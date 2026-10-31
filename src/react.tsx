import { createContext, memo, useCallback, useContext, useLayoutEffect, useMemo, useState, type Key, type ReactNode } from 'react'
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
} from './actions.js'
import { type Change, type OnPatches, rootSetter, type StoreOptions } from './patches.js'
import { getterOf, narrowSetter, type Narrower, type SetStore } from './store.js'

/**
 * Like `useState`, but a function passed to the setter mutates a draft.
 *
 * With an action set from `defineActions`, returns the set's actions bound to the store instead of a setter, so
 * they're the only way to write. The state type then comes from the set, and `initial` is checked against it.
 *
 * `options.onPatches` gets the JSON patches for each update, after it's committed.
 */
export function useNewStore<T extends object>(initial: T | (() => T), options?: StoreOptions): [T, SetStore<T>]
export function useNewStore<L extends RootActions>(
  initial: NoInfer<ActionState<L>> | (() => NoInfer<ActionState<L>>),
  actions: L,
  options?: StoreOptions,
): [ActionState<L>, BoundActions<L>]
export function useNewStore(initial: any, actionsOrOptions?: RootActions | StoreOptions, options?: StoreOptions): [any, any] {
  const actions = isActionSet(actionsOrOptions) ? (actionsOrOptions as RootActions) : undefined
  const { onPatches } = (actions ? options : (actionsOrOptions as StoreOptions | undefined)) ?? {}
  const [state, set] = useRootStore(initial, onPatches)
  const bound = useMemo(() => actions && bindActions(set, actions as ActionTree<object, unknown, unknown>), [set, actions])
  return [state, bound ?? set]
}

function useRootStore(initial: object | (() => object), onPatches?: OnPatches): [object, SetStore<object>] {
  const [state, setState] = useState(initial)
  // Made once, so the setter keeps its identity like useState's.
  const [root] = useState(() => patchLog(setState, state))
  useLayoutEffect(() => root.listen(onPatches), [root, onPatches])
  useLayoutEffect(() => root.committed(state), [root, state])
  return [state, root.set]
}

/**
 * A root setter that, while something listens, keeps each update's change until its commit. An update can run more
 * than once (in Strict Mode, or when React rebases it), so a commit reports only the changes that lead to the state
 * it committed.
 */
function patchLog(setState: (fn: (prev: object) => object) => void, initial: object) {
  let listener: OnPatches | undefined
  let last = initial
  const changes = new Map<object, Change>() // by the state each made
  const set = rootSetter(setState, () => listener && ((change) => void changes.set(change.next, change)))
  return {
    set,
    listen(onPatches: OnPatches | undefined) {
      listener = onPatches
    },
    committed(state: object) {
      const done: Change[] = []
      for (let s = state; s !== last; ) {
        const change = changes.get(s)
        // Made before there was a listener, so there's nothing to report.
        if (!change) {
          done.length = 0
          break
        }
        done.unshift(change)
        s = change.prev
      }
      last = state
      changes.clear()
      for (const c of done) listener?.(c.patches, c.inversePatches, { applied: c.applied })
    },
  }
}

/**
 * Narrows a store to the part `narrow` picks, returning that part and a setter that writes back into the store.
 *
 * For an action store, pick a level from its actions instead, like `useNarrowedStore(app, (a) => a.todo(id),
 * appActions)`: it returns that level's value and its actions, both from the one pick, so they can't disagree. Like
 * the setter, the level keeps its identity while `pick` does.
 */
export function useNarrowedStore<T extends object, N extends object>(store: T, narrow: Narrower<T, N>, setStore: SetStore<T>): [N, SetStore<N>]
export function useNarrowedStore<T extends object, B extends object, L extends object>(
  store: T,
  pick: (actions: B) => L,
  actions: B,
): [BoundState<L>, L]
export function useNarrowedStore(store: object, narrowOrPick: any, setStoreOrActions: any): [any, any] {
  // A setter is a function; bound actions are an object.
  const isActions = typeof setStoreOrActions !== 'function'
  // The narrowed setter, or the picked level: either way, kept while its inputs are.
  const narrowed = useMemo(
    () => (isActions ? narrowOrPick(setStoreOrActions) : narrowSetter(setStoreOrActions, narrowOrPick)),
    [isActions, setStoreOrActions, narrowOrPick],
  )
  const value = isActions ? readLevel(setStoreOrActions, store, narrowed) : getterOf(narrowOrPick)(store)
  if (value == null) throw new Error('react-narrow: the narrowed node is missing (narrow returned null/undefined)')
  return [value, narrowed]
}

// The three ways NarrowList renders an item, chosen by which of `setStore` and `actions` it's given.
type WithSetter<T extends object, K, I extends object> = {
  setStore: SetStore<I>
  actions?: undefined
  children: (item: T, setItem: SetStore<T>, key: K) => ReactNode
}
// `actions` picks an item's level from an action set by its key, like `appActions.todo`.
type WithActions<T extends object, K, B> = {
  setStore?: undefined
  actions: (key: K) => B
  children: (item: T, itemActions: B, key: K) => ReactNode
}
// For a list whose items have no writes of their own: each item is only memoized.
type ReadOnly<T extends object, K> = { setStore?: undefined; actions?: undefined; children: (item: T, key: K) => ReactNode }

type ArrayItems<T extends object, K> = { items: T[]; getKey: (item: T, index: number) => K }
type KeyedItems<I> = { items: I; getKey?: undefined }

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

type Items = object[] | Record<string, object> | Map<Key, object>
type GetKey = (item: object, index: number) => Key

/**
 * Renders every item of an array, record or Map as its own memoized component, so only changed items re-render.
 * With `setStore`, each item also gets a setter for itself. With `actions` (a level that takes the item's key), it
 * gets that level's actions instead. With neither, `children` gets the item and its key.
 */
function NarrowListImpl({ items, setStore, getKey, actions, children }: {
  items: Items
  setStore?: SetStore<any>
  getKey?: GetKey
  actions?: (key: Key) => object
  children: (...args: any[]) => ReactNode
}) {
  // Its JSX is only in a callback, so the compiler doesn't infer that it's a component on its own.
  'use memo'
  const kind: ItemKind = Array.isArray(items) ? 'array' : items instanceof Map ? 'map' : 'record'
  const entries: [Key, object][] = Array.isArray(items)
    ? items.map((item, i) => [getKey!(item, i), item])
    : items instanceof Map
      ? [...items]
      : Object.entries(items)
  return entries.map(([key, item]) =>
    setStore ? (
      <SetterListItem key={key} itemKey={key} item={item} kind={kind} setStore={setStore} getKey={getKey} render={children} />
    ) : actions ? (
      <ActionListItem key={key} itemKey={key} item={item} actions={actions} render={children} />
    ) : (
      <ReadOnlyListItem key={key} itemKey={key} item={item} render={children} />
    ),
  )
}

export const NarrowList = memo(NarrowListImpl) as NarrowListComponent

type ItemKind = 'array' | 'map' | 'record'

// How to find the item with `key` in the list.
function narrowToItem(kind: ItemKind, key: Key, getKey?: GetKey): Narrower<any, object> {
  if (kind === 'array') return (items: object[]) => items.find((item, i) => getKey!(item, i) === key)
  if (kind === 'map') return { get: (m: Map<Key, object>) => m.get(key), swap: (d, v) => void d.set(key, v) }
  return (r: Record<string, object>) => r[String(key)]
}

const SetterListItem = memo(function SetterListItem(props: {
  itemKey: Key
  item: object
  kind: ItemKind
  setStore: SetStore<any>
  getKey?: GetKey
  render: (item: object, setItem: SetStore<any>, key: Key) => ReactNode
}) {
  const { itemKey, item, kind, setStore, getKey, render } = props
  // Kept while these are, so a row given the setter can skip re-rendering.
  const setItem = useMemo(() => narrowSetter(setStore, narrowToItem(kind, itemKey, getKey)), [setStore, kind, getKey, itemKey])
  return render(item, setItem, itemKey)
})

const ActionListItem = memo(function ActionListItem(props: {
  itemKey: Key
  item: object
  actions: (key: Key) => object
  render: (item: object, itemActions: object, key: Key) => ReactNode
}) {
  const { itemKey, item, actions, render } = props
  // Kept while the level and key are, like SetterListItem's setter.
  const itemActions = useMemo(() => actions(itemKey), [actions, itemKey])
  return render(item, itemActions, itemKey)
})

const ReadOnlyListItem = memo(function ReadOnlyListItem(props: { itemKey: Key; item: object; render: (item: object, key: Key) => ReactNode }) {
  return props.render(props.item, props.itemKey)
})

/** A store shared through context: `useVal()` re-renders on changes, `useSet()` never does. */
export interface ContextStore<T extends object> {
  useVal(): T
  useSet(): SetStore<T>
}

type ProviderProps<T extends object> =
  | { store: T; setStore: SetStore<T>; initial?: never; onPatches?: never; children?: ReactNode }
  | { initial: T | (() => T); onPatches?: OnPatches; store?: never; setStore?: never; children?: ReactNode }

export interface StoreContext<T extends object> extends ContextStore<T> {
  Provider(props: ProviderProps<T>): ReactNode
}

// What a context holds with no Provider above it.
const NONE = Symbol('no provider')

const readOnlyDefault = (() => {
  throw new Error('react-narrow: no store in context; the default value is read-only')
}) as SetStore<any>

// The value and the setter go in separate contexts, so components that only write don't re-render.
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
  // Its own component, so useNewStore only runs when the Provider owns the store.
  function Owned(p: { initial: T | (() => T); onPatches?: OnPatches; children?: ReactNode }) {
    const [value, set] = useNewStore(p.initial, { onPatches: p.onPatches })
    return <Provide value={value} set={set}>{p.children}</Provide>
  }
  function Provider({ store, setStore, initial, onPatches, children }: ProviderProps<T>) {
    if (initial !== undefined) return <Owned initial={initial} onPatches={onPatches}>{children}</Owned>
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
    // `narrow` with the argument filled in, kept while it is.
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
  | { store: T; actions: B; initial?: never; onPatches?: never; children?: ReactNode }
  | { initial: T | (() => T); onPatches?: OnPatches; store?: never; actions?: never; children?: ReactNode }

export interface ActionStoreContext<T, B> extends ActionContextStore<T, B> {
  /** Owns a new store made from `initial` (with `onPatches`, see useNewStore), or shares one from `useNewStore` as `store` and `actions`. */
  Provider(props: ActionProviderProps<T, B>): ReactNode
}

// Like makeContext, with the bound actions in place of the setter. There's no fallback: actions need a store.
function makeActionContext<T, B>() {
  const ValueCtx = createContext<T | typeof NONE>(NONE)
  const ActionsCtx = createContext<B | typeof NONE>(NONE)
  const provided = <V,>(v: V | typeof NONE) => {
    if (v === NONE) throw new Error('react-narrow: no action store found in context')
    return v
  }
  const def: ActionContextStore<T, B> = {
    useVal: () => provided(useContext(ValueCtx)),
    useActions: () => provided(useContext(ActionsCtx)),
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
  // Its own component, so useNewStore only runs when the Provider owns the store.
  function Owned(p: { initial: ActionState<L> | (() => ActionState<L>); onPatches?: OnPatches; children?: ReactNode }) {
    const [value, bound] = useNewStore(p.initial, actions, { onPatches: p.onPatches })
    return <Provide value={value} actions={bound}>{p.children}</Provide>
  }
  function Provider({ store, actions: bound, initial, onPatches, children }: ActionProviderProps<ActionState<L>, BoundActions<L>>) {
    if (initial !== undefined) return <Owned initial={initial} onPatches={onPatches}>{children}</Owned>
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
    // `pick` with the argument filled in, kept while it is.
    const pickWithArg = useCallback((actions: B) => pick(actions, arg), [arg])
    const [value, level] = useNarrowedStore(useVal() as object, pickWithArg, useActions())
    return <Provide value={value} actions={level}>{props.children}</Provide>
  }
  return { ...def, Provider }
}
