import {
  createContext,
  memo,
  type DependencyList,
  type Key,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Draft } from 'mutative'
import { applyUpdate, getterOf, narrowSetter, type Container, type Narrower, type SetStore } from './store.js'

export function useNewStore<T extends Container>(initial: T | (() => T)): [T, SetStore<T>] {
  const [state, setState] = useState(initial)
  const [set] = useState(() => ((next: unknown, mode?: 'mutate' | 'swap') => setState((prev) => applyUpdate(prev, next, mode))) as SetStore<T>)
  return [state, set]
}

export function useNarrowedStore<T extends Container, N extends Container>(
  store: T,
  narrow: Narrower<T, N>,
  setStore: SetStore<T>,
  deps?: DependencyList,
): [N, SetStore<N>] {
  const set = useMemo(() => narrowSetter(setStore, narrow), deps ? [setStore, ...deps] : [setStore, narrow])
  const value = getterOf(narrow)(store)
  if (value == null) throw new Error('narrow: the narrowed node is missing (narrow returned null/undefined)')
  return [value, set]
}

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
    // Not keyed on `getKey` (here or in the comparison below): it's read once, like a React key.
    const setItem = useMemo(
      () => narrowSetter(setStore, (items: any[]) => items.find((x, i) => getKey(x, i) === itemKey)),
      [setStore, itemKey],
    )
    return render(item, setItem)
  },
  (a, b) => a.item === b.item && a.itemKey === b.itemKey && a.setStore === b.setStore && a.render === b.render,
)

export interface ContextStore<T extends Container> {
    useVal(): T
    useSet(): SetStore<T>
}

export interface StoreContext<T extends Container> extends ContextStore<T> {
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

// Separate value and setter contexts, so setter-only consumers don't re-render.
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
    return props.setStore ? (
      <Provide value={props.store as T} set={props.setStore}>{props.children}</Provide>
    ) : (
      <Owned initial={props.initial!}>{props.children}</Owned>
    )
  }
  return { ...def, Provider }
}

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
