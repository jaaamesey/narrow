import { describe, expect, it } from 'vitest'
import { applyUpdate, getterOf, narrowSetter, type Narrower, type SetStore } from './store'

// Applies setter calls like React's state updater would.
function createStore<T extends object>(initial: T) {
  let state = initial
  const set = ((next: unknown, mode?: 'mutate' | 'swap') => {
    state = applyUpdate(state, next, mode)
  }) as SetStore<T>
  return { get: () => state, set }
}

function narrowStore<T extends object, N extends object>(store: { get(): T; set: SetStore<T> }, narrow: Narrower<T, N>) {
  return { get: () => getterOf(narrow)(store.get())!, set: narrowSetter(store.set, narrow) }
}

type Todo = { id: number; text: string; done: boolean }
type S = { count: number; todos: Todo[]; meta: { tags: string[] } }
const init = (): S => ({
  count: 0,
  todos: [
    { id: 1, text: 'a', done: false },
    { id: 2, text: 'b', done: false },
  ],
  meta: { tags: [] },
})

describe('createStore setters', () => {
  it('mutates immutably and keeps structural sharing', () => {
    const store = createStore(init())
    const before = store.get()
    store.set((s) => { s.todos[0]!.done = true })
    const after = store.get()
    expect(before.todos[0]!.done).toBe(false)
    expect(after.todos[0]!.done).toBe(true)
    expect(after.todos[1]).toBe(before.todos[1])
    expect(after.meta).toBe(before.meta)
  })

  it('accepts expression-bodied assignments as mutations', () => {
    const store = createStore(init())
    store.set((s) => (s.count = 5))
    expect(store.get().count).toBe(5)
  })

  it('swaps with a value, and with a function of the current state', () => {
    const store = createStore(init())
    store.set({ ...init(), count: 9 })
    expect(store.get().count).toBe(9)
    store.set((s) => ({ ...s, count: s.count + 1 }), 'swap')
    expect(store.get().count).toBe(10)
  })

  it('ignores a value returned from a mutate recipe at runtime (the types forbid it)', () => {
    const store = createStore({ n: 0 })
    store.set(((s: { n: number }) => { s.n = 1; return { n: 99 } }) as any)
    expect(store.get().n).toBe(1)
  })

  it('a write that changes nothing returns the same state, so React can skip the re-render', () => {
    const store = createStore(init())
    const before = store.get()
    store.set((s) => void (s.count = 0))
    store.set(before)
    expect(store.get()).toBe(before)
  })

  it('enforces the mutate/swap distinction in types', () => {
    const store = createStore(init())
    // @ts-expect-error returning a new state without "swap" is a type error
    const a = () => store.set((s) => ({ ...s, count: 1 }))
    // @ts-expect-error even a partial/wrong-shaped state
    const b = () => store.set((s) => ({ count: 1 }))
    // @ts-expect-error "mutate" mode must not return a state
    const c = () => store.set((s) => ({ ...s }), 'mutate')
    // @ts-expect-error returning any object (even an unrelated one) is a forgotten swap
    const f = () => store.set((s) => ({ unrelated: 1 }))
    // @ts-expect-error nested object assignment as an expression body also returns an object
    const g = () => store.set((s) => (s.meta = { tags: [] }))
    // @ts-expect-error swap value must be the full state
    const d = () => store.set({ count: 1 })
    // @ts-expect-error swap recipe must return the state, not void
    const e = () => store.set((s) => { s.count = 1 }, 'swap')
    void [a, b, c, d, e, f, g]
  })
})

describe('narrowStore', () => {
  it('reads through to the source', () => {
    const store = createStore(init())
    const todo = narrowStore(store, (s) => s.todos[1]!)
    expect(todo.get()).toBe(store.get().todos[1])
    store.set((s) => void (s.todos[1]!.text = 'changed'))
    expect(todo.get().text).toBe('changed')
  })

  it('mutate writes through, leaving unrelated nodes shared', () => {
    const store = createStore(init())
    const todo = narrowStore(store, (s) => s.todos[0]!)
    const before = store.get()
    todo.set((t) => void (t.done = true))
    expect(store.get().todos[0]!.done).toBe(true)
    expect(store.get().todos[1]).toBe(before.todos[1])
    expect(store.get().meta).toBe(before.meta)
  })

  it('swap writes through for objects, including removed keys', () => {
    const store = createStore({ box: { a: 1, b: 2 } as Record<string, number> })
    const box = narrowStore(store, (s) => s.box)
    box.set({ a: 5, c: 3 })
    expect(store.get().box).toEqual({ a: 5, c: 3 })
    box.set((cur) => ({ ...cur, d: cur.a! }), 'swap')
    expect(store.get().box).toEqual({ a: 5, c: 3, d: 5 })
  })

  it('swap writes through for arrays (grow, shrink, reorder)', () => {
    const store = createStore(init())
    const todos = narrowStore(store, (s) => s.todos)
    todos.set((cur) => [...cur].reverse(), 'swap')
    expect(store.get().todos.map((t) => t.id)).toEqual([2, 1])
    todos.set([store.get().todos[0]!])
    expect(store.get().todos.map((t) => t.id)).toEqual([2])
  })

  it('swapping in an equal-by-reference value is a no-op', () => {
    const store = createStore(init())
    const before = store.get()
    const todos = narrowStore(store, (s) => s.todos)
    todos.set(todos.get())
    todos.set((cur) => cur, 'swap')
    expect(store.get()).toBe(before)
  })

  it('narrows a narrowed store, writing through every level', () => {
    const store = createStore({ a: { b: { c: { n: 0 } }, sibling: {} }, other: {} })
    const before = store.get()
    const b = narrowStore(store, (s) => s.a.b)
    const c = narrowStore(b, (x) => x.c)
    c.set((x) => void x.n++)
    c.set((x) => ({ n: x.n * 10 }), 'swap')
    expect(store.get().a.b.c.n).toBe(10)
    expect(store.get().a.sibling).toBe(before.a.sibling)
    expect(store.get().other).toBe(before.other)
  })

  it('consecutive writes through different narrowed setters all land', () => {
    const store = createStore(init())
    const first = narrowStore(store, (s) => s.todos[0]!)
    const second = narrowStore(store, (s) => s.todos[1]!)
    first.set((t) => void (t.done = true))
    second.set((t) => void (t.text = 'x'))
    first.set((t) => void (t.text = 'y'))
    expect(store.get().todos).toEqual([
      { id: 1, text: 'y', done: true },
      { id: 2, text: 'x', done: false },
    ])
  })

  it('ignores writes once the target is gone', () => {
    const store = createStore(init())
    const second = narrowStore(store, (s) => s.todos[1]!)
    store.set((s) => void s.todos.pop())
    const before = store.get()
    second.set((t) => void (t.done = true))
    second.set({ id: 9, text: 'x', done: false })
    expect(store.get()).toBe(before)
  })

  it('swap really replaces the node, even with a different kind of value', () => {
    const store = createStore({ slot: [1, 2] as unknown as object, other: { keep: 1 } })
    const before = store.get()
    narrowStore(store, (s) => s.slot).set({ now: 'an object' })
    expect(store.get().slot).toEqual({ now: 'an object' })
    expect(store.get().other).toBe(before.other)
  })

  it('swapping the whole state through an identity narrow replaces the parent state', () => {
    const store = createStore(init())
    narrowStore(store, (s) => s).set((s) => ({ ...s, count: 42 }), 'swap')
    expect(store.get().count).toBe(42)
  })

  it('narrowing with find() targets the matching node', () => {
    const store = createStore(init())
    const todo = narrowStore(store, (s) => s.todos.find((t) => t.id === 2)!)
    todo.set({ id: 2, text: 'swapped', done: true })
    todo.set((t) => void (t.text += '!'))
    expect(store.get().todos[1]).toEqual({ id: 2, text: 'swapped!', done: true })
  })

  it('throws instead of silently dropping writes when narrowFn returns a copy', () => {
    const store = createStore(init())
    const copy = narrowStore(store, (s) => ({ ...s.meta }))
    expect(() => copy.set((m) => void m.tags.push('x'))).toThrow(/inside the state/)
    expect(() => copy.set({ tags: [] })).toThrow(/inside the state/)
  })

  it('an untraceable function narrow (identity comparison) throws instead of silently doing nothing', () => {
    const store = createStore(init())
    const ref = store.get().todos[1]!
    const todo = narrowStore(store, (s) => s.todos.find((t) => t === ref)!)
    expect(todo.get()).toBe(ref)
    expect(() => todo.set((t) => void (t.done = true))).toThrow(/Pass \{ get, swap \}/)
  })

  it('{ get, swap } handles identity comparisons, for mutate and swap', () => {
    const store = createStore(init())
    const ref = store.get().todos[1]!
    const todo = narrowStore(store, {
      get: (s) => s.todos.find((t) => t === ref)!,
      swap: (d, v) => void (d.todos[d.todos.findIndex((t) => t.id === ref.id)] = v),
    })
    const before = store.get()
    todo.set((t) => void (t.done = true))
    expect(store.get().todos[1]).toEqual({ ...ref, done: true })
    expect(store.get().todos[0]).toBe(before.todos[0])
  })

  it('{ get, swap } handles Map entries', () => {
    const store = createStore({ byId: new Map([['a', { n: 1 }]]) })
    const entry = narrowStore(store, { get: (s) => s.byId.get('a')!, swap: (d, v) => void d.byId.set('a', v) })
    entry.set((e) => void e.n++)
    entry.set((e) => ({ n: e.n * 10 }), 'swap')
    expect(store.get().byId.get('a')).toEqual({ n: 20 })
  })

  it('{ get, swap } makes computed views writable', () => {
    const store = createStore({ first: 'Ada', last: 'Lovelace', other: {} })
    const name = narrowStore(store, {
      get: (s) => ({ full: `${s.first} ${s.last}` }),
      swap: (d, v) => void ([d.first, d.last] = v.full.split(' ') as [string, string]),
    })
    name.set((n) => void (n.full = 'Grace Hopper'))
    expect(store.get()).toMatchObject({ first: 'Grace', last: 'Hopper' })
  })

  it('function narrows trace through frozen state', () => {
    const deepFreeze = <V,>(v: V): V => (Object.values(v as object).forEach((c) => c && typeof c === 'object' && deepFreeze(c)), Object.freeze(v))
    const store = createStore(deepFreeze(init()))
    const todo = narrowStore(store, (s) => s.todos.find((t) => t.id === 2)!)
    todo.set((t) => void (t.done = true))
    narrowStore(store, (s) => s.meta).set({ tags: ['x'] })
    narrowStore(store, (s) => s.todos.filter((t) => t.done)[0]!).set((t) => void (t.text = 'via filter'))
    expect(store.get().todos[1]).toEqual({ id: 2, text: 'via filter', done: true })
    expect(store.get().meta.tags).toEqual(['x'])
  })

  it('a function narrow through a getter throws instead of silently doing nothing', () => {
    const store = createStore({ items: [{ v: 1 }], get first() { return this.items[0]! } })
    const first = narrowStore(store, (s) => s.first)
    expect(first.get()).toBe(store.get().items[0])
    expect(() => first.set({ v: 2 })).toThrow(/Pass \{ get, swap \}/)
  })

  it("a bug in a narrow function surfaces as itself, not as a tracing error", () => {
    const store = createStore(init())
    const broken = narrowStore(store, (s) => (s as any).missing.deeper as S['meta'])
    expect(() => broken.set((m) => void m.tags.push('x'))).toThrow(TypeError)
  })

  it('a narrow function may return undefined (e.g. find) without a non-null assertion', () => {
    const store = createStore(init())
    const todo = narrowStore(store, (s) => s.todos.find((t) => t.id === 2))
    todo.set((t) => void (t.done = true))
    expect(store.get().todos[1]!.done).toBe(true)
  })

  it('works with Map and Set', () => {
    const store = createStore({ m: new Map([['a', 1]]), s: new Set([1]) })
    narrowStore(store, (s) => s.m).set(new Map([['b', 2]]))
    narrowStore(store, (s) => s.s).set((s) => void s.add(2))
    expect([...store.get().m]).toEqual([['b', 2]])
    expect([...store.get().s]).toEqual([1, 2])
  })

  it('only allows narrowing to objects/arrays', () => {
    const store = createStore(init())
    // @ts-expect-error primitives can't be stores
    const bad = () => narrowSetter(store.set, (s) => s.count)
    void bad
  })
})

describe('narrowed writes go down the path, not through the whole store', () => {
  type Item = { id: string; x: number }
  type Page = { source: number; items: Item[] }
  type Doc = { work: { pages: Page[] }; ui: { page: number } }
  const doc = (pages = 4, per = 3): Doc => ({
    work: { pages: Array.from({ length: pages }, (_, source) => ({ source, items: Array.from({ length: per }, (_, i) => ({ id: `${source}-${i}`, x: 0 })) })) },
    ui: { page: 0 },
  })
  // state -> work.pages -> page by source -> items -> item by id, as an editor builds it.
  const chain = (store: { get(): Doc; set: SetStore<Doc> }, source: number, id: string) => {
    const pages = narrowStore(store, (s) => s.work.pages)
    const page = narrowStore(pages, (ps) => ps.find((p) => p.source === source)!)
    const items = narrowStore(page, (p) => p.items)
    const item = narrowStore(items, (its) => its.find((it) => it.id === id)!)
    return { pages, page, items, item }
  }

  it('an edit four levels down changes only that item and shares everything else', () => {
    const store = createStore(doc())
    const before = store.get()
    chain(store, 2, '2-1').item.set((it) => { it.x = 5 })
    const after = store.get()
    expect(after.work.pages[2]!.items[1]!.x).toBe(5)
    expect(before.work.pages[2]!.items[1]!.x).toBe(0)
    expect(after.work.pages[0]).toBe(before.work.pages[0])
    expect(after.work.pages[1]).toBe(before.work.pages[1])
    expect(after.work.pages[3]).toBe(before.work.pages[3])
    expect(after.work.pages[2]!.items[0]).toBe(before.work.pages[2]!.items[0])
    expect(after.ui).toBe(before.ui)
  })

  it('a swap at any level replaces that level and shares the rest', () => {
    const store = createStore(doc())
    const before = store.get()
    const { item, items, page } = chain(store, 1, '1-0')
    item.set({ id: '1-0', x: 9 })
    expect(store.get().work.pages[1]!.items[0]).toEqual({ id: '1-0', x: 9 })
    items.set((its) => its.filter((it) => it.id !== '1-2'), 'swap')
    expect(store.get().work.pages[1]!.items.map((it) => it.id)).toEqual(['1-0', '1-1'])
    page.set((p) => ({ ...p, items: [] }), 'swap')
    expect(store.get().work.pages[1]!.items).toEqual([])
    expect(store.get().work.pages[0]).toBe(before.work.pages[0])
  })

  it('a write that changes nothing returns the very same state, at every level', () => {
    const store = createStore(doc())
    const before = store.get()
    const { item, items, page, pages } = chain(store, 1, '1-1')
    item.set((it) => void it.x)
    item.set(before.work.pages[1]!.items[1]!)
    items.set((its) => its, 'swap')
    page.set((p) => { void p.source })
    pages.set((ps) => ps, 'swap')
    expect(store.get()).toBe(before)
  })

  it('a node that is gone is a silent no-op', () => {
    const store = createStore(doc())
    const before = store.get()
    const { item } = chain(store, 1, 'nope')
    item.set((it) => { it.x = 1 })
    expect(store.get()).toBe(before)
  })

  it('a narrowing that is the whole store can still be swapped', () => {
    const store = createStore(doc(1, 1))
    const all = narrowStore(store, (s) => s)
    all.set({ ...doc(2, 1), ui: { page: 1 } })
    expect(store.get().work.pages).toHaveLength(2)
    expect(store.get().ui.page).toBe(1)
    all.set((s) => { s.ui.page = 0 })
    expect(store.get().ui.page).toBe(0)
  })

  it('{ get, swap } narrowing still works in the chain, in both modes', () => {
    const store = createStore({ byId: new Map([['a', { n: 1 }], ['b', { n: 2 }]]), other: { k: 1 } })
    const before = store.get()
    const a = narrowStore(store, { get: (s) => s.byId.get('a')!, swap: (d, v) => void d.byId.set('a', v) })
    a.set((t) => { t.n = 10 })
    expect(store.get().byId.get('a')).toEqual({ n: 10 })
    a.set({ n: 11 })
    expect(store.get().byId.get('a')).toEqual({ n: 11 })
    expect(store.get().byId.get('b')).toBe(before.byId.get('b'))
    expect(store.get().other).toBe(before.other)
  })

  it('does not read the pages it is not writing to (the cost no longer grows with the size of the store)', () => {
    let reads = 0
    const spy = <O extends object>(o: O): O => new Proxy(o, { get: (t, k, r) => (reads++, Reflect.get(t, k, r)), ownKeys: (t) => (reads++, Reflect.ownKeys(t)) })
    const base = doc(50, 20)
    // The page written to comes first, so tracing the path stops there; everything after it is only ever read by something that scans the store.
    const store = createStore({ ...base, work: { pages: base.work.pages.map((p, i) => (i === 0 ? p : spy(p))) } })
    chain(store, 0, '0-3').item.set((it) => { it.x = 1 })
    expect(store.get().work.pages[0]!.items[3]!.x).toBe(1)
    expect(reads).toBe(0)
  })
})
