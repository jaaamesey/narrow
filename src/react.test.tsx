import { act, render, screen } from '@testing-library/react'
import { memo, StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  createContextStore,
  createNarrowedStoreContext,
  Narrow,
  useNarrowedStore,
  useNewStore,
  useStoreValue,
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

  it('supports all three setStore forms through context', () => {
    render(
      <def.Provider initial={init()}>
        <Title />
        <SetterOnly />
      </def.Provider>,
    )
    act(() => setStore((s) => void (s.title = 'mutated')))
    expect(screen.getByTestId('title').textContent).toBe('mutated')
    act(() => setStore({ ...init(), title: 'swapped' }))
    expect(screen.getByTestId('title').textContent).toBe('swapped')
    act(() => setStore((s) => ({ ...s, title: s.title + '!' }), 'swap'))
    expect(screen.getByTestId('title').textContent).toBe('swapped!')
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
    const setterRenders = renders.setter
    act(() => setStore((s) => void (s.title = 'x')))
    act(() => setStore((s) => void (s.title = 'y')))
    expect(renders.setter).toBe(setterRenders)
    expect(renders.probe).toBe(1)
    expect(seen.size).toBe(1)
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

describe('useNewStore / useStoreValue', () => {
  it('selectors limit re-renders to changes in the selected value', () => {
    let set!: (n: number) => void
    function App() {
      const [store, setStore] = useNewStore(init())
      set = (n) => setStore((s) => void s.todos.push({ id: n, text: '', done: false }))
      return (
        <>
          <Count store={store} />
          <First store={store} />
        </>
      )
    }
    function Count({ store }: { store: ReturnType<typeof useNewStore<S>>[0] }) {
      tick('count')
      return <b data-testid="count">{useStoreValue(store, (s) => s.todos.length)}</b>
    }
    function First({ store }: { store: ReturnType<typeof useNewStore<S>>[0] }) {
      tick('first')
      return <i>{useStoreValue(store, (s) => s.todos[0]!.text)}</i>
    }
    render(<StrictMode><App /></StrictMode>)
    const firstRenders = renders.first!
    act(() => set(9))
    expect(screen.getByTestId('count').textContent).toBe('4')
    expect(renders.first).toBe(firstRenders)
  })

  it('the owner does not re-render when the store changes', () => {
    let set!: (t: string) => void
    function App() {
      tick('owner')
      const [, setStore] = useNewStore(init())
      set = (t) => setStore((s) => void (s.title = t))
      return null
    }
    render(<App />)
    act(() => set('x'))
    expect(renders.owner).toBe(1)
  })
})

describe('narrowing', () => {
  const Row = memo(function Row({ id, value }: { id: number; value: Todo }) {
    tick(`row${id}`)
    return <li data-testid={`row${id}`}>{value.text}:{String(value.done)}</li>
  })

  it('<Narrow> re-renders only the item that changed and writes back to the parent', () => {
    const toggles: Array<() => void> = []
    let setRoot!: (fn: (s: S) => void) => void
    function List() {
      const [store, set] = useNewStore(init())
      setRoot = set
      const ids = useStoreValue(store, (s) => s.todos.map((t) => t.id).join())
      return (
        <ul>
          {ids.split(',').map((_, i) => (
            <Narrow key={i} store={store} by={(s) => s.todos[i]!}>
              {(todo, setTodo) => {
                toggles[i] = () => setTodo((t) => void (t.done = !t.done))
                return <Row id={i} value={todo} />
              }}
            </Narrow>
          ))}
        </ul>
      )
    }
    render(<List />)
    const before = { ...renders }
    act(() => toggles[1]!())
    expect(screen.getByTestId('row1').textContent).toBe('b:true')
    expect(renders.row1).toBe(before.row1! + 1)
    expect(renders.row0).toBe(before.row0)
    expect(renders.row2).toBe(before.row2)

    // writes to the parent are visible through the narrowed view too
    act(() => setRoot((s) => void (s.todos[2]!.text = 'zzz')))
    expect(screen.getByTestId('row2').textContent).toBe('zzz:false')
  })

  it('a list item removed from the parent does not crash its still-mounted child', () => {
    let set!: (fn: (s: S) => void) => void
    function App() {
      const [store, setStore] = useNewStore(init())
      set = setStore
      // Parent does NOT subscribe: the stale child is rendered against a vanished item.
      return (
        <>
          <Narrow store={store} by={(s) => s.todos[2]!}>{(t) => <p data-testid="p">{t.text}</p>}</Narrow>
        </>
      )
    }
    render(<App />)
    act(() => set((s) => void s.todos.pop()))
    expect(screen.getByTestId('p').textContent).toBe('c')
  })

  it('useNarrowedStore returns a store usable like any other, including further narrowing', () => {
    let setText!: (t: string) => void
    function Item({ store }: { store: ReturnType<typeof useNewStore<S>>[0] }) {
      const [todo] = useNarrowedStore(store, (s) => s.todos[0]!)
      const [self, setSelf] = useNarrowedStore(todo, (t) => t) // chain
      setText = (t) => setSelf((x) => void (x.text = t))
      return <span data-testid="t">{useStoreValue(self).text}</span>
    }
    function App() {
      const [store] = useNewStore(init())
      return <Item store={store} />
    }
    render(<App />)
    act(() => setText('hi'))
    expect(screen.getByTestId('t').textContent).toBe('hi')
  })

  it('narrowed contexts read and write through the parent context, and chain', () => {
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
