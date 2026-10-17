import { describe, expect, it, vi } from 'vitest'
import { createStore, getterOf, narrowSetter, type Container, type Narrower, type SetStore } from './store'

/** A read-through view of `store` for tests: value is always derived from the parent. */
function narrowStore<T extends Container, N extends Container>(store: { get(): T; set: SetStore<T> }, narrow: Narrower<T, N>) {
  return { get: () => getterOf(narrow)(store.get()), set: narrowSetter(store.set, narrow) }
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

  it('infers mutate for functions and swap for values', () => {
    const store = createStore({ n: 0 })
    // Even if a (type-invalid) recipe returns a value, mutate mode ignores it.
    store.set(((s: { n: number }) => { s.n = 1; return { n: 99 } }) as any)
    expect(store.get().n).toBe(1)
  })

  it('only notifies when state actually changed', () => {
    const store = createStore(init())
    const l = vi.fn()
    store.subscribe(l)
    store.set((s) => void (s.count = 0)) // no-op write
    store.set(store.get()) // same reference
    expect(l).not.toHaveBeenCalled()
    store.set((s) => void s.count++)
    expect(l).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes', () => {
    const store = createStore(init())
    const l = vi.fn()
    store.subscribe(l)()
    store.set((s) => void s.count++)
    expect(l).not.toHaveBeenCalled()
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
    const l = vi.fn()
    store.subscribe(l)
    const todos = narrowStore(store, (s) => s.todos)
    todos.set(todos.get())
    todos.set((cur) => cur, 'swap')
    expect(l).not.toHaveBeenCalled()
  })

  it('narrows a narrowed store', () => {
    const store = createStore(init())
    const meta = narrowStore(store, (s) => s.meta)
    const tags = narrowStore(meta, (m) => m.tags)
    tags.set((t) => void t.push('x'))
    tags.set((t) => [...t, 'y'], 'swap')
    expect(store.get().meta.tags).toEqual(['x', 'y'])
    expect(meta.get().tags).toBe(tags.get())
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
    expect(todo.get()).toBe(ref) // reads are plain values, so identity works
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
