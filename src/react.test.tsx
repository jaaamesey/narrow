import { act, render, screen } from '@testing-library/react'
import { memo, StrictMode, useCallback } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createContextStore,
  createNarrowedStoreContext,
  Narrow,
  useNarrowedStore,
  useNewStore,
  type SetStore,
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
        <def.Provider store={store} setStore={set}>
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

  it('useNarrowedStore(store, fn, setStore) reads and writes through to the parent', () => {
    let setRoot!: (fn: (s: S) => void) => void
    function App() {
      const [store, set] = useNewStore(init())
      setRoot = set
      const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[1]!, set)
      return <button data-testid="t" onClick={() => setTodo((t) => void (t.done = true))}>{todo.text}:{String(todo.done)}:{store.todos[1]!.done ? 'parent-done' : ''}</button>
    }
    render(<App />)
    act(() => screen.getByTestId('t').click())
    expect(screen.getByTestId('t').textContent).toBe('b:true:parent-done')
    act(() => setRoot((s) => void (s.todos[1]!.text = 'zzz')))
    expect(screen.getByTestId('t').textContent).toBe('zzz:true:parent-done')
  })

  it('without a setter the result is read-only, enforced by types', () => {
    function App() {
      const [store] = useNewStore(init())
      const narrowed = useNarrowedStore(store, (s) => s.todos[0]!)
      // @ts-expect-error no setter was given, so there is no second element
      const [, setTodo] = narrowed
      return <div data-testid="ro">{narrowed[0].text}{String(setTodo)}</div>
    }
    render(<App />)
    expect(screen.getByTestId('ro').textContent).toBe('aundefined')
  })

  it('the narrowed setter is stable even with an inline narrowFn', () => {
    const setters = new Set<unknown>()
    let bump!: () => void
    function App() {
      const [store, set] = useNewStore(init())
      bump = () => set((s) => void (s.title += '.'))
      const [, setTodo] = useNarrowedStore(store, (s) => s.todos[0]!, set)
      setters.add(setTodo)
      return null
    }
    render(<App />)
    act(() => bump())
    act(() => bump())
    expect(setters.size).toBe(1)
  })

  it('<Narrow> items: toggling one row re-renders only that row', () => {
    function List() {
      const [store, setStore] = useNewStore(init())
      return (
        <ul>
          {store.todos.map((t, i) => (
            <Narrow key={t.id} store={store} setStore={setStore} by={(s) => s.todos[i]!}>
              {(todo, setTodo) => <Row id={i} value={todo} toggle={useStable(setTodo)} />}
            </Narrow>
          ))}
        </ul>
      )
    }
    // Row is memo'd: give it a toggle that doesn't change identity.
    function useStable(setTodo: (fn: (t: Todo) => void) => void) {
      return useCallback(() => setTodo((x) => void (x.done = !x.done)), [setTodo])
    }
    render(<List />)
    const before = { ...renders }
    act(() => screen.getByTestId('row1').click())
    expect(screen.getByTestId('row1').textContent).toBe('b:true')
    expect(renders.row1).toBe(before.row1! + 1)
    expect(renders.row0).toBe(before.row0)
    expect(renders.row2).toBe(before.row2)
  })

  it('<Narrow> without setStore renders read-only', () => {
    function App() {
      const [store] = useNewStore(init())
      return <Narrow store={store} by={(s) => s.todos[2]!}>{(t) => <p data-testid="p">{t.text}</p>}</Narrow>
    }
    render(<App />)
    expect(screen.getByTestId('p').textContent).toBe('c')
  })

  it('a still-mounted child whose item was removed keeps its last value instead of crashing', () => {
    let set!: SetStore<S>
    function Item({ store, setStore }: { store: S; setStore: SetStore<S> }) {
      const [t, setT] = useNarrowedStore(store, (s) => s.todos[2]!, setStore)
      lastSet = setT
      return <p data-testid="p">{t.text}</p>
    }
    let lastSet!: (fn: (t: Todo) => void) => void
    function App() {
      const [store, setStore] = useNewStore(init())
      set = setStore
      return <Item store={store} setStore={setStore} />
    }
    render(<App />)
    act(() => set((s) => void s.todos.pop()))
    expect(screen.getByTestId('p').textContent).toBe('c')
    const after = () => lastSet((t) => void (t.text = 'nope')) // write to vanished node: no-op, no throw
    expect(() => act(after)).not.toThrow()
  })

  it('narrowing a narrowed value: pass the narrowed value and narrowed setter', () => {
    function App() {
      const [store, set] = useNewStore(init())
      const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[0]!, set)
      const [text, setText] = useNarrowedStore(todo, (t) => ({ ...t }) as Todo, setTodo) // detached copy: writes are no-ops
      void text
      const [self, setSelf] = useNarrowedStore(todo, (t) => t, setTodo)
      return <button data-testid="b" onClick={() => { setText((x) => void (x.text = 'ignored')); setSelf((x) => void (x.text = 'deep')) }}>{self.text}</button>
    }
    render(<App />)
    act(() => screen.getByTestId('b').click())
    expect(screen.getByTestId('b').textContent).toBe('deep')
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

  it('narrowed contexts: consumers re-render only when their node changes; setter-only never', () => {
    const todosDef = createContextStore<S>()
    const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!)
    let root!: ReturnType<typeof todosDef.useSet>
    function Root() {
      root = todosDef.useSet()
      return null
    }
    function Reader({ i }: { i: number }) {
      tick(`read${i}`)
      return <i>{todoDef.use().text}</i>
    }
    function Writer() {
      tick('write')
      todoDef.useSet()
      return null
    }
    render(
      <todosDef.Provider initial={init()}>
        <Root />
        {[0, 1].map((i) => (
          <todoDef.Provider key={i} arg={i}>
            <Reader i={i} />
            <Writer />
          </todoDef.Provider>
        ))}
      </todosDef.Provider>,
    )
    act(() => root((s) => void (s.todos[0]!.text = 'changed')))
    expect(renders.read0).toBe(2)
    expect(renders.read1).toBe(1)
    expect(renders.write).toBe(2) // once per Provider, from mount only
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
