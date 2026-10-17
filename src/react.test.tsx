import { act, render, screen } from '@testing-library/react'
import { memo, StrictMode } from 'react'
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

  it('throws without a provider or default', () => {
    const err = console.error
    console.error = () => {}
    try {
      expect(() => render(<Title />)).toThrow(/no store found/)
    } finally {
      console.error = err
    }
  })

  it('without a provider, the default is a read-only value (not a shared store)', () => {
    const withDefault = createContextStore<S>(init())
    let set!: typeof setStore
    function Reader() {
      set = withDefault.useSet() // obtaining the setter is fine...
      return <div data-testid="r">{withDefault.use().title}</div>
    }
    render(<Reader />)
    expect(screen.getByTestId('r').textContent).toBe('t')
    expect(() => set((s) => void (s.title = 'x'))).toThrow(/read-only/) // ...calling it is not
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

  it('deps re-target the setter; an unchanged deps list keeps it stable', () => {
    const setters: unknown[] = []
    function App({ i }: { i: number }) {
      const [store, set] = useNewStore(init())
      const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[i]!, set, [i])
      setters.push(setTodo)
      return <button data-testid="b" onClick={() => setTodo((t) => void (t.text = 'hit'))}>{todo.text}</button>
    }
    const { rerender } = render(<App i={0} />)
    rerender(<App i={0} />)
    expect(setters[0]).toBe(setters[1])
    rerender(<App i={1} />)
    expect(setters[2]).not.toBe(setters[1])
    expect(screen.getByTestId('b').textContent).toBe('b')
    act(() => screen.getByTestId('b').click())
    expect(screen.getByTestId('b').textContent).toBe('hit') // wrote to todo 1, the new target
  })

  it('without deps, the setter follows the narrow function (never writes to a stale target)', () => {
    function App({ i }: { i: number }) {
      const [store, set] = useNewStore(init())
      const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[i]!, set)
      return <button data-testid="b" onClick={() => setTodo((t) => void (t.text = 'hit'))}>{todo.text}|{store.todos.map((t) => t.text).join()}</button>
    }
    const { rerender } = render(<App i={0} />)
    rerender(<App i={1} />)
    act(() => screen.getByTestId('b').click())
    expect(screen.getByTestId('b').textContent).toBe('hit|a,hit,c')
  })

  it('without deps, the setter is stable when the narrow function is', () => {
    const setters = new Set<unknown>()
    let bump!: () => void
    const first = (s: S) => s.todos[0]!
    function App() {
      const [store, set] = useNewStore(init())
      bump = () => set((s) => void (s.title += '.'))
      const [, setTodo] = useNarrowedStore(store, first, set)
      setters.add(setTodo)
      return null
    }
    render(<App />)
    act(() => bump())
    act(() => bump())
    expect(setters.size).toBe(1)
  })

  it('<Narrow> items: changing one row re-renders only that row (unchanged items keep identity)', () => {
    const Row = memo(function Row({ id, value }: { id: number; value: Todo }) {
      tick(`row${id}`)
      return <li data-testid={`row${id}`}>{value.text}:{String(value.done)}</li>
    })
    function List() {
      const [store, setStore] = useNewStore(init())
      return (
        <ul>
          {store.todos.map((t, i) => (
            <Narrow key={t.id} store={store} setStore={setStore} by={(s) => s.todos[i]!}>
              {(todo, setTodo) => (
                <>
                  <Row id={i} value={todo} />
                  <button data-testid={`t${i}`} onClick={() => setTodo((x) => void (x.done = !x.done))} />
                </>
              )}
            </Narrow>
          ))}
        </ul>
      )
    }
    render(<List />)
    const before = { ...renders }
    act(() => screen.getByTestId('t1').click())
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

  it('removing an item unmounts its row without errors; a stale handler for it is a no-op', () => {
    let setRoot!: SetStore<S>
    let staleSet!: SetStore<Todo>
    function App() {
      const [store, setStore] = useNewStore(init())
      setRoot = setStore
      return (
        <>
          {store.todos.map((t, i) => (
            <Narrow key={t.id} store={store} setStore={setStore} by={(s) => s.todos[i]!}>
              {(todo, setTodo) => {
                if (i === 2) staleSet = setTodo
                return <p data-testid={`p${i}`}>{todo.text}</p>
              }}
            </Narrow>
          ))}
        </>
      )
    }
    render(<App />)
    act(() => setRoot((s) => void s.todos.pop()))
    expect(screen.queryByTestId('p2')).toBeNull()
    expect(() => act(() => staleSet((t) => void (t.text = 'nope')))).not.toThrow()
    expect(screen.getByTestId('p1').textContent).toBe('b')
  })

  it('narrowing a narrowed value: pass the narrowed value and narrowed setter', () => {
    type Deep = { inner: { n: number } }
    function App() {
      const [store, set] = useNewStore<Deep>({ inner: { n: 0 } })
      const [inner, setInner] = useNarrowedStore(store, (s) => s.inner, set)
      const [self, setSelf] = useNarrowedStore(inner, (i) => i, setInner)
      return <button data-testid="b" onClick={() => setSelf((x) => void x.n++)}>{self.n}:{store.inner.n}</button>
    }
    render(<App />)
    act(() => screen.getByTestId('b').click())
    expect(screen.getByTestId('b').textContent).toBe('1:1')
  })

  it('<Narrow> and narrowed contexts accept { get, swap }', () => {
    type M = { byId: Map<string, Todo> }
    const mDef = createContextStore<M>()
    const entryDef = createNarrowedStoreContext(mDef, {
      get: (s, id: string) => s.byId.get(id)!,
      swap: (d, v, id) => void d.byId.set(id, v),
    })
    function CtxView() {
      const set = entryDef.useSet()
      return <button data-testid="ctx" onClick={() => set((t) => void (t.text = 'ctx'))}>{entryDef.use().text}</button>
    }
    function App() {
      const [store, setStore] = useNewStore<M>({ byId: new Map([['a', { id: 1, text: 'a', done: false }], ['b', { id: 2, text: 'b', done: false }]]) })
      return (
        <mDef.Provider store={store} setStore={setStore}>
          <Narrow store={store} setStore={setStore} by={{ get: (s) => s.byId.get('a')!, swap: (d, v) => void d.byId.set('a', v) }}>
            {(t, setT) => <button data-testid="narrow" onClick={() => setT((x) => void (x.text = 'narrow'))}>{t.text}</button>}
          </Narrow>
          <entryDef.Provider arg="b"><CtxView /></entryDef.Provider>
        </mDef.Provider>
      )
    }
    render(<App />)
    act(() => screen.getByTestId('narrow').click())
    act(() => screen.getByTestId('ctx').click())
    expect(screen.getByTestId('narrow').textContent).toBe('narrow')
    expect(screen.getByTestId('ctx').textContent).toBe('ctx')
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

  it('narrowed context follows a changing arg, for reads and writes', () => {
    const todosDef = createContextStore<S>()
    const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!)
    let set!: ReturnType<typeof todoDef.useSet>
    function View() {
      set = todoDef.useSet()
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
    act(() => set((t) => void (t.text = 'written')))
    expect(screen.getByTestId('v').textContent).toBe('written') // wrote to todo 2, not the stale todo 0
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
