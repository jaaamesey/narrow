import { act, render, screen } from '@testing-library/react'
import { memo, StrictMode, useCallback } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createContextStore,
  createNarrowedStoreContext,
  Narrow,
  useNarrowedStore,
  useNewStore,
  useSelector,
} from './index'

type Todo = { id: number; text: string; done: boolean }
type S = { title: string; todos: Todo[] }
const init = (): S => ({
  title: 't',
  todos: [
    { id: 0, text: 'a', done: false },
    { id: 1, text: 'b', done: false },
    { id: 2, text: 'c', done: false },
  ],
})

/** Counts renders per label, so we can assert who did (not) re-render. */
const renders: Record<string, number> = {}
const tick = (k: string) => (renders[k] = (renders[k] ?? 0) + 1)
beforeEach(() => void Object.keys(renders).forEach((k) => delete renders[k]))

describe('useNewStore', () => {
  it('returns the plain value, like useState, and supports all three setter forms', () => {
    let setStore!: (typeof useNewStore<S>) extends (...a: any) => [any, infer F] ? F : never
    function App() {
      const [store, set] = useNewStore(init())
      setStore = set
      return <div data-testid="title">{store.title}</div>
    }
    render(<StrictMode><App /></StrictMode>)
    const title = () => screen.getByTestId('title').textContent
    act(() => setStore((s) => void (s.title = 'mutated')))
    expect(title()).toBe('mutated')
    act(() => setStore({ ...init(), title: 'swapped' }))
    expect(title()).toBe('swapped')
    act(() => setStore((s) => ({ ...s, title: s.title + '!' }), 'swap'))
    expect(title()).toBe('swapped!')
  })

  it('two stores created from the same initial object stay independent', () => {
    const shared = init()
    const sets: Array<(fn: (s: S) => void) => void> = []
    function A({ i }: { i: number }) {
      const [store, set] = useNewStore(shared)
      sets[i] = set
      const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[0]!)
      return <div data-testid={`s${i}`}>{todo.text}<button onClick={() => setTodo((t) => void (t.text = `x${i}`))} data-testid={`b${i}`} /></div>
    }
    render(<><A i={0} /><A i={1} /></>)
    act(() => screen.getByTestId('b0').click())
    expect(screen.getByTestId('s0').textContent).toBe('x0')
    expect(screen.getByTestId('s1').textContent).toBe('a')
    expect(shared.todos[0]!.text).toBe('a') // never mutated
  })

  it('useSelector limits re-renders to changes in the selected value', () => {
    let add!: () => void
    const Count = memo(function Count({ store }: { store: S }) {
      tick('count')
      return <b data-testid="count">{useSelector(store, (s) => s.todos.length)}</b>
    })
    const Title = memo(function Title({ store }: { store: S }) {
      tick('title')
      return <i>{useSelector(store, (s) => s.title)}</i>
    })
    function App() {
      const [store, setStore] = useNewStore(init())
      add = () => setStore((s) => void s.todos.push({ id: 9, text: '', done: false }))
      return <><Count store={store} /><Title store={store} /></>
    }
    render(<App />)
    act(() => add())
    expect(screen.getByTestId('count').textContent).toBe('4')
  })
})

describe('context store', () => {
  const def = createContextStore<S>()
  let setStore!: ReturnType<typeof def.useSet>

  function Title() {
    tick('title')
    return <div data-testid="title">{def.use().title}</div>
  }
  function SetterOnly() {
    tick('setter')
    setStore = def.useSet()
    return null
  }

  it('shares one store through context; use() is the value, useSet() mutates it', () => {
    render(
      <def.Provider initial={init()}>
        <Title />
        <SetterOnly />
      </def.Provider>,
    )
    act(() => setStore((s) => void (s.title = 'mutated')))
    expect(screen.getByTestId('title').textContent).toBe('mutated')
    act(() => setStore((s) => ({ ...s, title: s.title + '!' }), 'swap'))
    expect(screen.getByTestId('title').textContent).toBe('mutated!')
  })

  it('does not re-render setter-only consumers, and the setter is stable', () => {
    const seen = new Set<unknown>()
    function Probe() {
      seen.add(def.useSet())
      tick('probe')
      return null
    }
    render(
      <def.Provider initial={init()}>
        <Title />
        <Probe />
        <SetterOnly />
      </def.Provider>,
    )
    act(() => setStore((s) => void (s.title = 'x')))
    act(() => setStore((s) => void (s.title = 'y')))
    expect(renders.setter).toBe(1)
    expect(renders.probe).toBe(1)
    expect(renders.title).toBe(3)
    expect(seen.size).toBe(1)
  })

  it('a store value from useNewStore can be provided to context', () => {
    function App() {
      const [store, set] = useNewStore(init())
      return (
        <def.Provider store={store}>
          <Title />
          <button data-testid="go" onClick={() => set((s) => void (s.title = 'from owner'))} />
        </def.Provider>
      )
    }
    render(<App />)
    act(() => screen.getByTestId('go').click())
    expect(screen.getByTestId('title').textContent).toBe('from owner')
  })

  it('throws without a provider or default; uses a shared default when given', () => {
    const err = console.error
    console.error = () => {}
    try {
      expect(() => render(<Title />)).toThrow(/no store found/)
    } finally {
      console.error = err
    }

    const withDefault = createContextStore<S>(init())
    let set!: typeof setStore
    function Reader({ id }: { id: string }) {
      set = withDefault.useSet()
      return <div data-testid={id}>{withDefault.use().title}</div>
    }
    render(<><Reader id="one" /><Reader id="two" /></>)
    act(() => set((s) => void (s.title = 'shared')))
    expect(screen.getByTestId('one').textContent).toBe('shared')
    expect(screen.getByTestId('two').textContent).toBe('shared')
  })

  it('a provider overrides the default', () => {
    const withDefault = createContextStore<S>(init())
    function Reader() {
      return <div data-testid="r">{withDefault.use().title}</div>
    }
    render(<withDefault.Provider initial={{ ...init(), title: 'provided' }}><Reader /></withDefault.Provider>)
    expect(screen.getByTestId('r').textContent).toBe('provided')
  })
})

describe('narrowing', () => {
  const Row = memo(function Row({ id, value, toggle }: { id: number; value: Todo; toggle: () => void }) {
    tick(`row${id}`)
    return <li data-testid={`row${id}`} onClick={toggle}>{value.text}:{String(value.done)}</li>
  })

  it('useNarrowedStore(store, fn) reads and writes through to the parent', () => {
    let setRoot!: (fn: (s: S) => void) => void
    function App() {
      const [store, set] = useNewStore(init())
      setRoot = set
      const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[1]!)
      return <button data-testid="t" onClick={() => setTodo((t) => void (t.done = true))}>{todo.text}:{String(todo.done)}:{store.todos[1]!.done ? 'parent-done' : ''}</button>
    }
    render(<App />)
    act(() => screen.getByTestId('t').click())
    expect(screen.getByTestId('t').textContent).toBe('b:true:parent-done')
    act(() => setRoot((s) => void (s.todos[1]!.text = 'zzz')))
    expect(screen.getByTestId('t').textContent).toBe('zzz:true:parent-done')
  })

  it('<Narrow> items: toggling one row re-renders only that row', () => {
    function List() {
      const [store] = useNewStore(init())
      return (
        <ul>
          {store.todos.map((t, i) => (
            <Narrow key={t.id} store={store} by={(s) => s.todos[i]!}>
              {(todo, setTodo) => <Row id={i} value={todo} toggle={useStable(() => setTodo((x) => void (x.done = !x.done)))} />}
            </Narrow>
          ))}
        </ul>
      )
    }
    // Row is memo'd and `toggle` is recreated by Narrow's render fn, so stabilise it for the assertion.
    function useStable(fn: () => void) {
      return useCallback(fn, [])
    }
    render(<List />)
    const before = { ...renders }
    act(() => screen.getByTestId('row1').click())
    expect(screen.getByTestId('row1').textContent).toBe('b:true')
    expect(renders.row1).toBe(before.row1! + 1)
    expect(renders.row0).toBe(before.row0)
    expect(renders.row2).toBe(before.row2)
  })

  it('a still-mounted child whose item was removed keeps its last value instead of crashing', () => {
    let set!: (fn: (s: S) => void) => void
    function Item({ store }: { store: S }) {
      const [t] = useNarrowedStore(store, (s) => s.todos[2]!)
      return <p data-testid="p">{t.text}</p>
    }
    function App() {
      const [store, setStore] = useNewStore(init())
      set = setStore
      return <Item store={store} />
    }
    render(<App />)
    act(() => set((s) => void s.todos.pop()))
    expect(screen.getByTestId('p').textContent).toBe('c')
  })

  it('narrowing a narrowed value', () => {
    function App() {
      const [store] = useNewStore(init())
      const [todo] = useNarrowedStore(store, (s) => s.todos[0]!)
      const [same, setSame] = useNarrowedStore(todo, (t) => t)
      return <button data-testid="b" onClick={() => setSame((x) => void (x.text = 'deep'))}>{same.text}</button>
    }
    render(<App />)
    act(() => screen.getByTestId('b').click())
    expect(screen.getByTestId('b').textContent).toBe('deep')
  })

  it('rejects values that did not come from the library', () => {
    function Bad() {
      useNarrowedStore(init(), (s) => s.todos)
      return null
    }
    const err = console.error
    console.error = () => {}
    try {
      expect(() => render(<Bad />)).toThrow(/not a store value/)
    } finally {
      console.error = err
    }
  })

  it('narrowed contexts read and write through the parent context', () => {
    const todosDef = createContextStore<S>()
    const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!)
    let root!: ReturnType<typeof todosDef.useSet>
    let setTodo!: ReturnType<typeof todoDef.useSet>
    function Root() {
      root = todosDef.useSet()
      return null
    }
    function TodoView() {
      setTodo = todoDef.useSet()
      return <div data-testid="todo">{todoDef.use().text}</div>
    }
    render(
      <todosDef.Provider initial={init()}>
        <Root />
        <todoDef.Provider arg={1}>
          <TodoView />
        </todoDef.Provider>
      </todosDef.Provider>,
    )
    expect(screen.getByTestId('todo').textContent).toBe('b')
    act(() => setTodo((t) => void (t.text = 'edited')))
    act(() => root((s) => void (s.todos[0]!.text = 'untouched')))
    expect(screen.getByTestId('todo').textContent).toBe('edited')
  })

  it('narrowed context follows a changing arg', () => {
    const todosDef = createContextStore<S>()
    const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!)
    function View() {
      return <div data-testid="v">{todoDef.use().text}</div>
    }
    const ui = (i: number) => (
      <todosDef.Provider initial={init()}>
        <todoDef.Provider arg={i}><View /></todoDef.Provider>
      </todosDef.Provider>
    )
    const { rerender } = render(ui(0))
    expect(screen.getByTestId('v').textContent).toBe('a')
    rerender(ui(2))
    expect(screen.getByTestId('v').textContent).toBe('c')
  })

  it('narrowed context falls back to its default when nothing is provided', () => {
    const todosDef = createContextStore<S>()
    const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!, { id: 7, text: 'dflt', done: false })
    function View() {
      return <div data-testid="v">{todoDef.use().text}</div>
    }
    render(<View />)
    expect(screen.getByTestId('v').textContent).toBe('dflt')
  })
})
