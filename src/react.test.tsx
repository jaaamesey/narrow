import { act, render, screen } from '@testing-library/react'
import { StrictMode, useCallback, useTransition } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createContextStore,
  createNarrowedStoreContext,
  NarrowList,
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

const renders: Record<string, number> = {}
const tick = (k: string) => (renders[k] = (renders[k] ?? 0) + 1)
beforeEach(() => {
  Object.keys(renders).forEach((k) => delete renders[k])
  vi.restoreAllMocks()
})

describe('useNewStore', () => {
  it('returns the plain value, like useState, and supports all three setter forms', () => {
    let setStore!: SetStore<S>
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
  it('updates are ordinary React updates, so they can run in a transition', () => {
    const seen: string[] = []
    let start!: () => void
    function App() {
      const [state, setState] = useNewStore(init())
      const [isPending, startTransition] = useTransition()
      start = () => startTransition(() => setState((s) => void (s.title = 'new')))
      seen.push(`${isPending ? 'pending' : 'idle'}:${state.title}`)
      return null
    }
    render(<App />)
    act(() => start())
    expect(seen).toEqual(['idle:t', 'pending:t', 'idle:new'])
  })
})

describe('context store', () => {
  const def = createContextStore<S>()
  let setStore!: ReturnType<typeof def.useSet>

  function Title() {
    tick('title')
    return <div data-testid="title">{def.useVal().title}</div>
  }
  function SetterOnly() {
    tick('setter')
    setStore = def.useSet()
    return null
  }

  it('shares one store through context; useVal() is the value, useSet() mutates it', () => {
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
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Title />)).toThrow(/no store found/)
  })

  it('without a provider, the default is a read-only value (not a shared store)', () => {
    const withDefault = createContextStore<S>(init())
    let set!: typeof setStore
    function Reader() {
      set = withDefault.useSet()
      return <div data-testid="r">{withDefault.useVal().title}</div>
    }
    render(<Reader />)
    expect(screen.getByTestId('r').textContent).toBe('t')
    expect(() => set((s) => void (s.title = 'x'))).toThrow(/read-only/)
  })

  it('a provider overrides the default', () => {
    const withDefault = createContextStore<S>(init())
    function Reader() {
      return <div data-testid="r">{withDefault.useVal().title}</div>
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

  it('a useCallback narrow function keeps the setter stable until its inputs change', () => {
    const setters: unknown[] = []
    function App({ i }: { i: number }) {
      const [store, set] = useNewStore(init())
      const pick = useCallback((s: S) => s.todos[i]!, [i])
      const [todo, setTodo] = useNarrowedStore(store, pick, set)
      setters.push(setTodo)
      return <button data-testid="b" onClick={() => setTodo((t) => void (t.text = 'hit'))}>{todo.text}</button>
    }
    const { rerender } = render(<App i={0} />)
    rerender(<App i={0} />)
    expect(setters[0]).toBe(setters[1])
    rerender(<App i={1} />)
    expect(setters[2]).not.toBe(setters[1])
    act(() => screen.getByTestId('b').click())
    expect(screen.getByTestId('b').textContent).toBe('hit')
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

  it('reading a missing node throws', () => {
    function App() {
      const [store, set] = useNewStore(init())
      useNarrowedStore(store, (s) => s.todos[99]!, set)
      return null
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<App />)).toThrow(/narrowed node is missing/)
  })

  it('<NarrowList>: writes go to the right item, by key, even after reordering', () => {
    let setRoot!: SetStore<S>
    const setters: Record<number, SetStore<Todo>> = {}
    // Hoisted, as the React Compiler would keep it stable.
    const renderItem = (todo: Todo, setTodo: SetStore<Todo>) => {
      setters[todo.id] = setTodo
      return <li data-testid={`li${todo.id}`}>{todo.text}</li>
    }
    function App() {
      const [store, set] = useNewStore(init())
      setRoot = set
      const [todos, setTodos] = useNarrowedStore(store, (s) => s.todos, set)
      return <NarrowList items={todos} setStore={setTodos} getKey={(t) => t.id}>{renderItem}</NarrowList>
    }
    render(<App />)
    act(() => setRoot((s) => void s.todos.reverse()))
    act(() => setters[0]!((t) => void (t.text = 'first, now last')))
    expect(screen.getByTestId('li0').textContent).toBe('first, now last')
    expect(screen.getByTestId('li2').textContent).toBe('c')
  })

  it('<NarrowList>: editing one item re-renders only that item, and setters stay stable', () => {
    // Hoisted, as the React Compiler would keep it stable.
    const pickTodos = (s: S) => s.todos
    const getKey = (t: Todo) => t.id
    const seen = new Set<unknown>()
    let setRoot!: SetStore<S>
    const renderItem = (todo: Todo, setTodo: SetStore<Todo>) => {
      tick(`item${todo.id}`)
      seen.add(setTodo)
      return <button data-testid={`b${todo.id}`} onClick={() => setTodo((t) => void (t.done = !t.done))}>{String(todo.done)}</button>
    }
    function App() {
      const [store, set] = useNewStore(init())
      setRoot = set
      const [todos, setTodos] = useNarrowedStore(store, pickTodos, set)
      return <NarrowList items={todos} setStore={setTodos} getKey={getKey}>{renderItem}</NarrowList>
    }
    render(<App />)
    const before = { ...renders }
    act(() => screen.getByTestId('b1').click())
    act(() => setRoot((s) => void (s.title = 'unrelated')))
    expect(screen.getByTestId('b1').textContent).toBe('true')
    expect(renders.item1).toBe(before.item1! + 1)
    expect(renders.item0).toBe(before.item0)
    expect(renders.item2).toBe(before.item2)
    expect(seen.size).toBe(3)
  })

  it('<NarrowList>: index keys target whatever is at that index', () => {
    let setRoot!: SetStore<S>
    const setters: SetStore<Todo>[] = []
    const renderItem = (todo: Todo, setTodo: SetStore<Todo>) => {
      setters[todo.id] = setTodo
      return <li data-testid={`li${todo.id}`}>{todo.text}</li>
    }
    function App() {
      const [store, set] = useNewStore(init())
      setRoot = set
      const [todos, setTodos] = useNarrowedStore(store, (s) => s.todos, set)
      return <NarrowList items={todos} setStore={setTodos} getKey={(_, i) => i}>{renderItem}</NarrowList>
    }
    render(<App />)
    const setAtIndex0 = setters[0]!
    act(() => setRoot((s) => void s.todos.shift()))
    act(() => setAtIndex0((t) => void (t.text = 'index 0')))
    expect(screen.getByTestId('li1').textContent).toBe('index 0')
  })

  it('<NarrowList>: items can be a filtered subset; writes land in the full array', () => {
    const setters: Record<number, SetStore<Todo>> = {}
    const renderItem = (todo: Todo, setTodo: SetStore<Todo>) => {
      setters[todo.id] = setTodo
      return <li data-testid={`li${todo.id}`}>{todo.text}</li>
    }
    let latest!: S
    function App() {
      // Ids differ from indexes, so a lookup by position would fail.
      const [store, set] = useNewStore<S>({ title: 't', todos: [10, 20, 30].map((id) => ({ id, text: String(id), done: false })) })
      latest = store
      const [todos, setTodos] = useNarrowedStore(store, (s) => s.todos, set)
      return <NarrowList items={todos.filter((t) => t.id !== 20)} setStore={setTodos} getKey={(t) => t.id}>{renderItem}</NarrowList>
    }
    render(<App />)
    expect(screen.queryByTestId('li20')).toBeNull()
    act(() => setters[30]!((t) => void (t.text = 'z')))
    expect(latest.todos.map((t) => t.text)).toEqual(['10', '20', 'z'])
  })

  it('<NarrowList>: several item writes in one event all land', () => {
    const setters: Record<number, SetStore<Todo>> = {}
    const renderItem = (todo: Todo, setTodo: SetStore<Todo>) => {
      setters[todo.id] = setTodo
      return <li data-testid={`li${todo.id}`}>{String(todo.done)}</li>
    }
    function App() {
      const [store, set] = useNewStore(init())
      const [todos, setTodos] = useNarrowedStore(store, (s) => s.todos, set)
      return <NarrowList items={todos} setStore={setTodos} getKey={(t) => t.id}>{renderItem}</NarrowList>
    }
    render(<App />)
    act(() => {
      for (const id of [0, 1, 2]) setters[id]!((t) => void (t.done = true))
    })
    expect([0, 1, 2].map((id) => screen.getByTestId(`li${id}`).textContent)).toEqual(['true', 'true', 'true'])
  })

  it('<NarrowList>: a stale setter for a removed item is a no-op', () => {
    let setRoot!: SetStore<S>
    let staleSet!: SetStore<Todo>
    const renderItem = (todo: Todo, setTodo: SetStore<Todo>) => {
      if (todo.id === 2) staleSet = setTodo
      return <li data-testid={`li${todo.id}`}>{todo.text}</li>
    }
    function App() {
      const [store, set] = useNewStore(init())
      setRoot = set
      const [todos, setTodos] = useNarrowedStore(store, (s) => s.todos, set)
      return <NarrowList items={todos} setStore={setTodos} getKey={(t) => t.id}>{renderItem}</NarrowList>
    }
    render(<App />)
    act(() => setRoot((s) => void s.todos.pop()))
    expect(() => act(() => staleSet((t) => void (t.text = 'nope')))).not.toThrow()
    expect(screen.queryByTestId('li2')).toBeNull()
  })

  it('<NarrowList> over a record: each entry gets its own setter, and only changed entries re-render', () => {
    type R = { byId: Record<string, Todo> }
    const pick = (s: R) => s.byId
    const renderItem = (todo: Todo, setTodo: SetStore<Todo>, key: string) => {
      tick(`rec-${key}`)
      return <button data-testid={`r-${key}`} onClick={() => setTodo((t) => void (t.done = true))}>{key}:{String(todo.done)}</button>
    }
    function App() {
      const [store, set] = useNewStore<R>({ byId: { x: { id: 1, text: 'x', done: false }, y: { id: 2, text: 'y', done: false } } })
      const [byId, setById] = useNarrowedStore(store, pick, set)
      return <NarrowList items={byId} setStore={setById}>{renderItem}</NarrowList>
    }
    render(<App />)
    act(() => screen.getByTestId('r-y').click())
    expect(screen.getByTestId('r-y').textContent).toBe('y:true')
    expect(screen.getByTestId('r-x').textContent).toBe('x:false')
    expect(renders['rec-x']).toBe(1)
    expect(renders['rec-y']).toBe(2)
  })

  it('<NarrowList> over a Map: writes land on the right entry', () => {
    type M = { byId: Map<string, Todo> }
    const pick = (s: M) => s.byId
    const renderItem = (todo: Todo, setTodo: SetStore<Todo>, key: string) => (
      <button data-testid={`m-${key}`} onClick={() => setTodo((t) => void (t.text += '!'))}>{todo.text}</button>
    )
    function App() {
      const [store, set] = useNewStore<M>({ byId: new Map([['a', { id: 1, text: 'a', done: false }], ['b', { id: 2, text: 'b', done: false }]]) })
      const [byId, setById] = useNarrowedStore(store, pick, set)
      return <NarrowList items={byId} setStore={setById}>{renderItem}</NarrowList>
    }
    render(<App />)
    act(() => screen.getByTestId('m-b').click())
    expect(screen.getByTestId('m-b').textContent).toBe('b!')
    expect(screen.getByTestId('m-a').textContent).toBe('a')
  })

  it('useNarrowedStore and narrowed contexts accept { get, swap }', () => {
    type M = { byId: Map<string, Todo> }
    const mDef = createContextStore<M>()
    const entryDef = createNarrowedStoreContext(mDef, {
      get: (s, id: string) => s.byId.get(id)!,
      swap: (d, v, id) => void d.byId.set(id, v),
    })
    function CtxView() {
      const set = entryDef.useSet()
      return <button data-testid="ctx" onClick={() => set((t) => void (t.text = 'ctx'))}>{entryDef.useVal().text}</button>
    }
    function EntryA({ store, setStore }: { store: M; setStore: SetStore<M> }) {
      const [t, setT] = useNarrowedStore(store, { get: (s) => s.byId.get('a')!, swap: (d, v) => void d.byId.set('a', v) }, setStore)
      return <button data-testid="narrow" onClick={() => setT((x) => void (x.text = 'narrow'))}>{t.text}</button>
    }
    function App() {
      const [store, setStore] = useNewStore<M>({ byId: new Map([['a', { id: 1, text: 'a', done: false }], ['b', { id: 2, text: 'b', done: false }]]) })
      return (
        <mDef.Provider store={store} setStore={setStore}>
          <EntryA store={store} setStore={setStore} />
          <entryDef.Provider narrowArg="b"><CtxView /></entryDef.Provider>
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
      return <div data-testid="todo">{todoDef.useVal().text}</div>
    }
    render(
      <todosDef.Provider initial={init()}>
        <Root />
        <todoDef.Provider narrowArg={1}>
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
      return <i>{todoDef.useVal().text}</i>
    }
    function Writer({ i }: { i: number }) {
      tick(`write${i}`)
      todoDef.useSet()
      return null
    }
    render(
      <todosDef.Provider initial={init()}>
        <Root />
        {[0, 1].map((i) => (
          <todoDef.Provider key={i} narrowArg={i}>
            <Reader i={i} />
            <Writer i={i} />
          </todoDef.Provider>
        ))}
      </todosDef.Provider>,
    )
    act(() => root((s) => void (s.todos[0]!.text = 'changed')))
    expect(renders.read0).toBe(2)
    expect(renders.read1).toBe(1)
    expect(renders.write0).toBe(1)
    expect(renders.write1).toBe(1)
  })

  it('narrowed context follows a changing narrowArg, for reads and writes', () => {
    const todosDef = createContextStore<S>()
    const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!)
    let set!: ReturnType<typeof todoDef.useSet>
    function View() {
      set = todoDef.useSet()
      return <div data-testid="v">{todoDef.useVal().text}</div>
    }
    const ui = (i: number) => (
      <todosDef.Provider initial={init()}>
        <todoDef.Provider narrowArg={i}><View /></todoDef.Provider>
      </todosDef.Provider>
    )
    const { rerender } = render(ui(0))
    expect(screen.getByTestId('v').textContent).toBe('a')
    rerender(ui(2))
    expect(screen.getByTestId('v').textContent).toBe('c')
    act(() => set((t) => void (t.text = 'written')))
    expect(screen.getByTestId('v').textContent).toBe('written')
  })

  it('narrowed context falls back to its default when nothing is provided', () => {
    const todosDef = createContextStore<S>()
    const todoDef = createNarrowedStoreContext(todosDef, (s, i: number) => s.todos[i]!, { id: 7, text: 'dflt', done: false })
    function View() {
      return <div data-testid="v">{todoDef.useVal().text}</div>
    }
    render(<View />)
    expect(screen.getByTestId('v').textContent).toBe('dflt')
  })
})

describe('server rendering and types', () => {
  it('renders on the server', () => {
    const def = createContextStore<S>()
    function Items() {
      const state = def.useVal()
      const setState = def.useSet()
      const [todos, setTodos] = useNarrowedStore(state, (s) => s.todos, setState)
      return <ul><NarrowList items={todos} setStore={setTodos} getKey={(t) => t.id}>{(t) => <li>{t.text}</li>}</NarrowList></ul>
    }
    expect(renderToString(<def.Provider initial={init()}><Items /></def.Provider>)).toBe('<ul><li>a</li><li>b</li><li>c</li></ul>')
  })

  it('rejects misuse at the type level', () => {
    const def = createContextStore<S>()
    const fixed = createNarrowedStoreContext(def, (s) => s.todos)
    const byIndex = createNarrowedStoreContext(def, (s, i: number) => s.todos[i]!)
    const checks = (store: S, setStore: SetStore<S>) => [
      // @ts-expect-error a Provider takes either a store or `initial`, not both
      <def.Provider store={store} setStore={setStore} initial={init()} />,
      // @ts-expect-error narrowArg is required when the narrow function takes one
      <byIndex.Provider />,
      // @ts-expect-error and not accepted when it doesn't
      <fixed.Provider narrowArg={1} />,
      // @ts-expect-error useNarrowedStore needs the parent's setter
      useNarrowedStore(store, (s) => s.todos),
      // @ts-expect-error getKey is only for arrays; records and Maps are keyed already
      <NarrowList items={{ a: init().todos[0]! }} setStore={null as unknown as SetStore<Record<string, Todo>>} getKey={() => 'a'}>{() => null}</NarrowList>,
      // @ts-expect-error narrowing must land on an object, not a primitive
      useNarrowedStore(store, (s) => s.title, setStore),
    ]
    expect(typeof checks).toBe('function')
  })
})
