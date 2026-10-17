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

export function useNewStore<T extends object>(initial: T | (() => T)): [T, SetStore<T>] {
  const [state, setState] = useState(initial)
  const [set] = useState(() => ((next: unknown, mode?: 'mutate' | 'swap') => setState((prev) => applyUpdate(prev, next, mode))) as SetStore<T>)
  return [state, set]
}

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

type NarrowListProps<T extends object> = {
  items: T[]
  setStore: SetStore<T[]>
  getKey: (item: T, index: number) => Key
  children: (item: T, setItem: SetStore<T>) => ReactNode
}

export function NarrowList<T extends object>({ items, setStore, getKey, children }: NarrowListProps<T>) {
  return items.map((item, index) => {
    const key = getKey(item, index)
    return <NarrowListItem key={key} itemKey={key} item={item} setStore={setStore} getKey={getKey} render={children} />
  })
}

type NarrowListItemProps<T extends object> = Omit<NarrowListProps<T>, 'items' | 'children'> & {
  itemKey: Key
  item: T
  render: NarrowListProps<T>['children']
}

const NarrowListItem = memo(function NarrowListItem<T extends object>({ itemKey, item, setStore, getKey, render }: NarrowListItemProps<T>) {
  const setItem = useMemo(
    () => narrowSetter<T[], T>(setStore, (items) => items.find((x, i) => getKey(x, i) === itemKey)),
    [setStore, getKey, itemKey],
  )
  return render(item, setItem)
}) as <T extends object>(props: NarrowListItemProps<T> & { key: Key }) => ReactNode

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
