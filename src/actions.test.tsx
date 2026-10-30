import { act, render, screen } from '@testing-library/react'
import { StrictMode, useMemo, useState } from 'react'
import { original } from 'mutative'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  createContextStore,
  createTestStore,
  createNarrowedStoreContext,
  defineActions,
  NarrowList,
  useNarrowedStore,
  useNewStore,
  type ActionSet,
  type BoundActions,
  type NarrowedActions,
  type Draft,
  withContext,
} from './index'
import { bindActions } from './actions'

type Tag = { name: string }
type Todo = { id: number; text: string; done: boolean; tags: Tag[] }
type Board = { id: string; todos: Todo[] }
type S = { title: string; todos: Todo[]; settings: { dark: boolean }; boards: Board[]; byId: Map<number, Todo> }
const todo = (id: number, text: string): Todo => ({ id, text, done: false, tags: [{ name: `${text}-tag` }] })
const init = (): S => ({
  title: 't',
  todos: [todo(0, 'a'), todo(1, 'b')],
  settings: { dark: false },
  boards: [{ id: 'b1', todos: [todo(10, 'x')] }],
  byId: new Map([[7, todo(7, 'm')]]),
})

// Each set would live in its own module, next to its type.
const tagActionSet = defineActions({
  rename(t: Tag, name: string) {
    t.name = name
  },
})
const todoActionSet = defineActions(
  {
    toggle(t: Todo) {
      t.done = !t.done
    },
    setText(t: Todo, text: string) {
      t.text = text
    },
  },
  (narrow) => ({ tag: narrow((t, i: number) => t.tags[i], tagActionSet) }),
)
const listActionSet = defineActions(
  {
    add(ts: Todo[], id: number, text: string) {
      ts.push(todo(id, text))
    },
    remove(ts: Todo[], id: number) {
      return ts.filter((t) => t.id !== id)
    },
    // Calls another set's action on a draft, which changes it in place.
    toggleAll(ts: Todo[]) {
      for (const t of ts) todoActionSet.toggle(t)
    },
  },
  (narrow) => ({ item: narrow((ts, id: number) => ts.find((t) => t.id === id), todoActionSet) }),
)
const settingsActionSet = defineActions({
  setDark(x: { dark: boolean }, dark: boolean) {
    x.dark = dark
  },
})
const appActionSet = defineActions(
  {
    rename(s: S, title: string) {
      s.title = title
    },
    reset(_: S) {
      return init()
    },
  },
  (narrow) => ({
    // The same sets are reused wherever their state appears.
    todos: narrow((s) => s.todos, listActionSet),
    settings: narrow((s) => s.settings, settingsActionSet),
    // A level with no actions of its own.
    board: narrow(
      (s, id: string) => s.boards.find((b) => b.id === id),
      defineActions<Board>()({}, (narrow) => ({ todos: narrow((b) => b.todos, listActionSet) })),
    ),
    // Not traceable: a Map lookup.
    byId: narrow({ get: (s, id: number) => s.byId.get(id), swap: (d, v, id) => void d.byId.set(id, v) }, todoActionSet),
  }),
)

type App = BoundActions<typeof appActionSet>
type TodoLevel = BoundActions<typeof todoActionSet>

describe('calling an action set directly', () => {
  it('returns the next state without changing the one passed in, whether the action mutates or replaces', () => {
    const t = todo(1, 'a')
    expect(todoActionSet.toggle(t).done).toBe(true)
    expect(t.done).toBe(false)
    const ts = [todo(1, 'a'), todo(2, 'b')]
    expect(listActionSet.remove(ts, 1).map((x) => x.id)).toEqual([2])
    expect(ts).toHaveLength(2)
    expectTypeOf(todoActionSet.setText).toEqualTypeOf<(state: Todo, text: string) => Todo>()
  })
  it('changes a draft in place, so one action can call another', () => {
    const ts = [todo(1, 'a'), todo(2, 'b')]
    expect(listActionSet.toggleAll(ts).map((t) => t.done)).toEqual([true, true])
    expect(ts.map((t) => t.done)).toEqual([false, false])
  })
})

describe('defineActions', () => {
  it('types every level from its set, including nested levels and levels with an argument', () => {
    // Only typechecked, never run.
    void ((a: App) => {
      expectTypeOf(a.rename).toEqualTypeOf<(title: string) => void>()
      expectTypeOf(a.todos.add).toEqualTypeOf<(id: number, text: string) => void>()
      expectTypeOf(a.todos.item).parameter(0).toEqualTypeOf<number>()
      expectTypeOf(a.todos.item(0).tag(0).rename).toEqualTypeOf<(name: string) => void>()
      expectTypeOf(a.board('b1').todos.item(0).toggle).toEqualTypeOf<() => void>()
      expectTypeOf(a.settings.setDark).toEqualTypeOf<(dark: boolean) => void>()
      // @ts-expect-error item takes a number
      a.todos.item('1')
      // @ts-expect-error not an action of a todo
      a.todos.item(1).add(1, 'x')
      // @ts-expect-error the board level has no actions of its own
      a.board('b1').toggle()
    })
  })
  it('rejects a set for the wrong level, narrows to missing properties, and primitive returns', () => {
    // @ts-expect-error the set is for a Todo, not Todo[]
    defineActions({ f(_: S) {} }, (narrow) => ({ todos: narrow((s) => s.todos, todoActionSet) }))
    // @ts-expect-error no such property
    defineActions({ f(_: S) {} }, (narrow) => ({ todos: narrow((s) => s.nope, listActionSet) }))
    // @ts-expect-error a number is not a state
    defineActions({
      f(d: S) {
        return (d.title = 'y')
      },
    })
  })
  it('takes the state type up front, typing each action’s state as a draft of it', () => {
    // A class instance and a typed array: a draft of them isn't the same type as them.
    class Source {
      constructor(public bytes: Uint8Array) {}
    }
    type Doc = { source: Source | null; todos: Todo[] }
    const findTodo = (d: Draft<Doc>, id: number) => d.todos.find((t) => t.id === id)
    const docActionSet = defineActions<Doc>()(
      {
        open(d, source: Source) {
          d.source = source
        },
        toggle(d, id: number) {
          const t = findTodo(d, id)
          if (t) t.done = !t.done
        },
        close() {
          return { source: null, todos: [] }
        },
      },
      (narrow) => ({ todo: narrow((d, id: number) => d.todos.find((t) => t.id === id), todoActionSet) }),
    )
    expectTypeOf(docActionSet.toggle).toEqualTypeOf<(state: Doc, id: number) => Doc>()
    const doc: Doc = { source: null, todos: [todo(1, 'a')] }
    expect(docActionSet.toggle(doc, 1).todos[0]!.done).toBe(true)
    const store = createTestStore(doc, docActionSet)
    store.actions.todo(1).setText('b')
    expect(store.state.todos[0]!.text).toBe('b')
    expect(docActionSet.open(doc, new Source(new Uint8Array(1))).source).toBeInstanceOf(Source)
    // With no actions of its own, a set can still narrow.
    const levelsOnly = defineActions<Doc>()({}, (narrow) => ({ todo: narrow((d, id: number) => d.todos.find((t) => t.id === id), todoActionSet) }))
    expect(createTestStore(doc, levelsOnly).state).toBe(doc)
    const bad = {
      bad() {
        return 1
      },
    }
    // @ts-expect-error a number is not a Doc
    defineActions<Doc>()(bad)
  })
  it('makes `this` unknown in an action that doesn’t declare it', () => {
    defineActions({
      inc(s: { n: number }) {
        s.n++
      },
      incTwice(s: { n: number }) {
        // @ts-expect-error `this` is the context, not the set
        this.inc(s)
      },
    })
  })
  it('still treats a plain object as a setter store’s fallback', () => {
    const ctx = createContextStore({ title: 'fallback' })
    let seen = ''
    function Comp() {
      seen = ctx.useVal().title
      return null
    }
    render(<Comp />)
    expect(seen).toBe('fallback')
    expectTypeOf(ctx.useSet).returns.not.toBeAny()
  })
  it('throws when a level has the same name as an action', () => {
    const clash = defineActions({ rename(_: S) {} }, (narrow) => ({ rename: narrow((s) => s.todos, listActionSet) }))
    expect(() => bindActions(createTestStore(init()).set, clash)).toThrow(/both an action/)
  })
})

describe('nesting to any depth', () => {
  type L5 = { v: number }
  type L4 = { e: L5[] }
  type L3 = { d: Record<string, L4> }
  type L2 = { c: L3 }
  type L1 = { b: L2[] }
  type Deep = { a: L1 }
  const leafActionSet = defineActions({
    inc(x: L5, by: number) {
      x.v += by
    },
  })
  // Written inline, each level a set with no actions of its own.
  const deepActionSet = defineActions<Deep>()({}, (narrow) => ({
    a: narrow((s) => s.a, defineActions<L1>()({}, (narrow) => ({
      b: narrow((x, i: number) => x.b[i], defineActions<L2>()({}, (narrow) => ({
        c: narrow((x) => x.c, defineActions<L3>()({}, (narrow) => ({
          d: narrow((x, k: string) => x.d[k], defineActions<L4>()({}, (narrow) => ({
            e: narrow((x, i: number) => x.e[i], leafActionSet),
          }))),
        }))),
      }))),
    }))),
  }))
  it('types and writes a level six deep', () => {
    const state: Deep = { a: { b: [{ c: { d: { k: { e: [{ v: 1 }] } } } }] } }
    const store = createTestStore(state, deepActionSet)
    store.actions.a.b(0).c.d('k').e(0).inc(2)
    expect(store.state.a.b[0]!.c.d.k!.e[0]!.v).toBe(3)
    expectTypeOf(store.actions.a.b(0).c.d('k').e(0).inc).toEqualTypeOf<(by: number) => void>()
  })

  // Recursive data: the set narrows to itself. Its type has to be written out, since TypeScript can't infer a
  // type that contains itself.
  type OutlineNode = { text: string; children: OutlineNode[] }
  const nodeFns = {
    setText(n: OutlineNode, text: string) {
      n.text = text
    },
    add(n: OutlineNode, text: string) {
      n.children.push({ text, children: [] })
    },
  }
  type NodeChildren = { child: NarrowedActions<number, OutlineNode, typeof nodeFns, NodeChildren> }
  const outlineActionSet: ActionSet<OutlineNode, typeof nodeFns, NodeChildren> = defineActions(nodeFns, (narrow) => ({
    child: narrow((n, i: number) => n.children[i], outlineActionSet),
  }))

  it('handles recursive data with a set that contains itself', () => {
    const store = createTestStore({ text: 'root', children: [] }, outlineActionSet)
    const a = store.actions
    a.add('1')
    a.child(0).add('1.1')
    a.child(0).child(0).add('1.1.1')
    a.child(0).child(0).child(0).add('1.1.1.1')
    a.child(0).child(0).child(0).child(0).setText('deepest')
    expectTypeOf(a.child(0).child(0).child(0).child(0).child(0).setText).toEqualTypeOf<(text: string) => void>()
    expect(store.state.children[0]!.children[0]!.children[0]!.children[0]!.text).toBe('deepest')
  })
  it('handles recursion through a level without an argument', () => {
    type Link = { v: number; next?: Link }
    const linkFns = {
      set(l: Link, v: number) {
        l.v = v
      },
    }
    type LinkChildren = { next: NarrowedActions<unknown, Link, typeof linkFns, LinkChildren> }
    const linkActionSet: ActionSet<Link, typeof linkFns, LinkChildren> = defineActions(linkFns, (narrow) => ({
      next: narrow((l) => l.next, linkActionSet),
    }))
    const store = createTestStore<typeof linkActionSet>({ v: 0, next: { v: 1, next: { v: 2 } } }, linkActionSet)
    store.actions.next.next.set(20)
    expect(store.state.next!.next!.v).toBe(20)
  })
})

describe('binding a set to a setter', () => {
  it('binds a set, writing each level into its own part of the state', () => {
    const store = createTestStore(init())
    const a = bindActions(store.set, appActionSet)
    const before = store.state
    a.todos.item(1).toggle()
    expect(store.state.todos[1]!.done).toBe(true)
    expect(store.state.todos[0]).toBe(before.todos[0])
    a.todos.item(0).tag(0).rename('renamed')
    expect(store.state.todos[0]!.tags[0]!.name).toBe('renamed')
    a.board('b1').todos.add(11, 'y')
    expect(store.state.boards[0]!.todos.map((t) => t.id)).toEqual([10, 11])
    a.byId(7).setText('M')
    expect(store.state.byId.get(7)!.text).toBe('M')
    a.settings.setDark(true)
    expect(store.state.settings.dark).toBe(true)
  })
  it('replaces just the narrowed part when a level action returns a value', () => {
    const store = createTestStore(init())
    bindActions(store.set, appActionSet).todos.remove(0)
    expect(store.state.todos.map((t) => t.id)).toEqual([1])
    expect(store.state.title).toBe('t')
  })
  it('ignores writes to an item that no longer exists', () => {
    const store = createTestStore(init())
    const a = bindActions(store.set, appActionSet)
    const gone = a.todos.item(0)
    a.todos.remove(0)
    const before = store.state
    gone.toggle()
    expect(store.state).toBe(before)
  })
  it('keeps a level without an argument, and binds a new one for each call with an argument', () => {
    const a = bindActions(createTestStore(init()).set, appActionSet)
    expect(a.todos).toBe(a.todos)
    // Nothing is cached per argument: where identity matters, React memoizes the level.
    expect(a.todos.item(1)).not.toBe(a.todos.item(1))
  })
  it('rejects a set for another state type', () => {
    // @ts-expect-error the set is for S
    bindActions(createTestStore({ other: 1 }).set, appActionSet)
  })
})

describe('createTestStore with an action set', () => {
  it('holds the latest state, and its actions apply at once', () => {
    const store = createTestStore(init, appActionSet)
    expectTypeOf(store.state).toEqualTypeOf<S>()
    expectTypeOf(store.actions).toEqualTypeOf<App>()
    store.actions.todos.item(0).toggle()
    store.actions.todos.item(0).tag(0).rename('z')
    expect(store.state.todos[0]).toMatchObject({ done: true, tags: [{ name: 'z' }] })
  })
  it('checks initial against the set', () => {
    // @ts-expect-error missing fields
    createTestStore({ title: '' }, appActionSet)
  })
})

describe('useNewStore with an action set', () => {
  it('returns the state and the bound actions, without a setter', () => {
    let a!: App
    let state!: S
    function Comp() {
      const result = useNewStore(init, appActionSet)
      expectTypeOf(result).toEqualTypeOf<[S, App]>()
      ;[state, a] = result
      return null
    }
    render(<StrictMode><Comp /></StrictMode>)
    act(() => a.todos.add(2, 'c'))
    expect(state.todos).toHaveLength(3)
    act(() => a.todos.item(2).toggle())
    expect(state.todos[2]!.done).toBe(true)
    act(() => a.todos.toggleAll())
    expect(state.todos.map((t) => t.done)).toEqual([true, true, false])
    act(() => a.reset())
    expect(state).toEqual(init())
  })
  it('keeps the bound actions stable across renders, so a memoized level is too', () => {
    const seen = new Set<unknown>()
    let a!: App
    function Comp() {
      ;[, a] = useNewStore(init, appActionSet)
      const item = useMemo(() => a.todos.item(1), [a])
      seen.add(item)
      return null
    }
    render(<Comp />)
    act(() => a.rename('x'))
    act(() => a.todos.item(1).toggle())
    expect(seen.size).toBe(1)
  })
  it('checks initial against the set, and takes only sets', () => {
    function Comp() {
      // @ts-expect-error missing fields
      useNewStore({ title: '' }, appActionSet)
      const plain = {
        inc(s: { n: number }) {
          s.n++
        },
      }
      // @ts-expect-error plain functions need defineActions
      useNewStore({ n: 0 }, plain)
      return null
    }
    void Comp
  })
})

describe('NarrowList with an action level', () => {
  it('gives each item its level, and only re-renders changed items', () => {
    let a!: App
    let state!: S
    const rows: Record<number, TodoLevel> = {}
    const renders: Record<number, number> = {}
    const getId = (t: Todo) => t.id
    const renderRow = (t: Todo, actions: TodoLevel) => {
      renders[t.id] = (renders[t.id] ?? 0) + 1
      rows[t.id] = actions
      return null
    }
    function Comp() {
      const [s, actions] = useNewStore(init, appActionSet)
      state = s
      a = actions
      return (
        <NarrowList items={s.todos} getKey={getId} actions={actions.todos.item}>
          {renderRow}
        </NarrowList>
      )
    }
    render(<Comp />)
    const before = rows[1]
    act(() => rows[1]!.toggle())
    expect(state.todos[1]!.done).toBe(true)
    expect(renders).toEqual({ 0: 1, 1: 2 })
    // The row re-rendered with the same actions: NarrowList memoizes each item's level.
    expect(rows[1]).toBe(before)
    act(() => a.rename('x'))
    expect(renders).toEqual({ 0: 1, 1: 2 })
  })
  it('works with a Map, and types children from the level', () => {
    let state!: S
    const acts: Record<number, TodoLevel> = {}
    function Comp() {
      const [s, a] = useNewStore(init, appActionSet)
      state = s
      return (
        <NarrowList items={s.byId} actions={a.byId}>
          {(t, actions, key) => {
            expectTypeOf(t).toEqualTypeOf<Todo>()
            expectTypeOf(key).toEqualTypeOf<number>()
            expectTypeOf(actions.toggle).toEqualTypeOf<() => void>()
            acts[key] = actions
            return null
          }}
        </NarrowList>
      )
    }
    render(<Comp />)
    act(() => acts[7]!.toggle())
    expect(state.byId.get(7)!.done).toBe(true)
  })
  it('rejects a level for another item type or key type', () => {
    function Comp() {
      const [s, a] = useNewStore(init, appActionSet)
      return (
        <>
          {/* @ts-expect-error the level is for a Tag */}
          <NarrowList items={s.todos} getKey={(t) => t.id} actions={(i: number) => a.todos.item(0).tag(i)}>
            {() => null}
          </NarrowList>
          {/* @ts-expect-error the level takes a number key */}
          <NarrowList items={s.todos} getKey={(t) => String(t.id)} actions={a.todos.item}>
            {() => null}
          </NarrowList>
        </>
      )
    }
    void Comp
  })
})

describe('createContextStore with an action set', () => {
  const ctx = createContextStore(appActionSet)
  it('owns a store, and useActions never re-renders', () => {
    let writerRenders = 0
    let a!: App
    let title = ''
    function Writer() {
      writerRenders++
      a = ctx.useActions()
      return null
    }
    function Reader() {
      title = ctx.useVal().title
      return null
    }
    render(
      <ctx.Provider initial={init}>
        <Writer />
        <Reader />
      </ctx.Provider>,
    )
    act(() => a.rename('ctx'))
    expect(title).toBe('ctx')
    act(() => a.todos.item(0).toggle())
    expect(writerRenders).toBe(1)
  })
  it('shares a store from useNewStore', () => {
    let a!: App
    let state!: S
    function Child() {
      a = ctx.useActions()
      return null
    }
    function Comp() {
      const [s, actions] = useNewStore(init, appActionSet)
      state = s
      return (
        <ctx.Provider store={s} actions={actions}>
          <Child />
        </ctx.Provider>
      )
    }
    render(<Comp />)
    act(() => a.todos.add(5, 'e'))
    expect(state.todos.map((t) => t.id)).toEqual([0, 1, 5])
  })
  it('throws without a Provider', () => {
    function Comp() {
      ctx.useActions()
      return null
    }
    expect(() => render(<Comp />)).toThrow(/no action store/)
  })
})

describe('createNarrowedStoreContext with an action context', () => {
  const ctx = createContextStore(appActionSet)
  const todoCtx = createNarrowedStoreContext(ctx, (a, id: number) => a.todos.item(id))
  const tagCtx = createNarrowedStoreContext(todoCtx, (a) => a.tag(0))

  it('gives a level and its value, re-rendering only when that value changes', () => {
    let rootActions!: App
    let todoRenders = 0
    let seen!: Todo
    let tagName = ''
    let renameTag!: (n: string) => void
    function TodoView() {
      todoRenders++
      seen = todoCtx.useVal()
      expectTypeOf(todoCtx.useActions().toggle).toEqualTypeOf<() => void>()
      return null
    }
    function TagView() {
      tagName = tagCtx.useVal().name
      renameTag = tagCtx.useActions().rename
      return null
    }
    function Root() {
      rootActions = ctx.useActions()
      return null
    }
    render(
      <ctx.Provider initial={init}>
        <Root />
        <todoCtx.Provider narrowArg={1}>
          <TodoView />
          <tagCtx.Provider>
            <TagView />
          </tagCtx.Provider>
        </todoCtx.Provider>
      </ctx.Provider>,
    )
    expect(seen.text).toBe('b')
    act(() => rootActions.todos.item(0).toggle())
    expect(todoRenders).toBe(1)
    act(() => rootActions.todos.item(1).toggle())
    expect(seen.done).toBe(true)
    expect(todoRenders).toBe(2)
    act(() => renameTag('nested'))
    expect(tagName).toBe('nested')
  })
  it('throws if the picked actions are not below the parent', () => {
    const elsewhere = bindActions(createTestStore(init()).set, appActionSet)
    const other = createNarrowedStoreContext(ctx, () => elsewhere.todos)
    expect(() =>
      render(
        <ctx.Provider initial={init}>
          <other.Provider />
        </ctx.Provider>,
      ),
    ).toThrow(/not a level below/)
  })
})

// An editor's shape: levels whose actions need things from above them (a page's size, the undo history, the
// selection), which their sets declare as `this`, and the levels that narrow to them provide.
describe('context', () => {
  type Item = { id: string; x: number; w: number }
  type Page = { id: string; items: Item[] }
  type Doc = { pages: Page[]; widths: Record<string, number>; past: Page[][]; selected: string | null }

  type Editing = { checkpoint(): void; select(id: string | null): void }
  type ItemContext = Editing & { pageWidth: number }
  type PageContext = Editing & { width: number }

  const itemActionSet = defineActions({
    moveTo(this: ItemContext, it: Item, x: number) {
      this.checkpoint()
      it.x = Math.min(x, this.pageWidth - it.w)
    },
    pick(this: Editing, it: Item) {
      this.select(it.id)
    },
    // Needs nothing from above.
    nudge(it: Item) {
      it.x += 1
    },
  })
  const pageActionSet = defineActions(
    {
      clear(this: PageContext, p: Page) {
        this.checkpoint()
        this.select(null)
        p.items = []
      },
    },
    (narrow) => ({
      item: narrow((p, id: string) => p.items.find((i) => i.id === id), itemActionSet, (_p, _id, page) => ({ ...page, pageWidth: page.width })),
    }),
  )
  const docActionSet = defineActions(
    {
      undo(d: Doc) {
        const previous = d.past.pop()
        if (previous) d.pages = previous
      },
    },
    (narrow) => ({
      // Everything a page's actions need, from the document's draft: they write to it in the same update.
      page: narrow((d, id: string) => d.pages.find((p) => p.id === id), pageActionSet, (d, id) => ({
        width: d.widths[id]!,
        checkpoint: () => void d.past.push(original(d.pages)),
        select: (item: string | null) => void (d.selected = item),
      })),
    }),
  )
  const doc = (): Doc => ({
    pages: [
      { id: 'p1', items: [{ id: 'a', x: 0, w: 10 }, { id: 'b', x: 0, w: 10 }] },
      { id: 'p2', items: [{ id: 'c', x: 0, w: 10 }] },
    ],
    widths: { p1: 100, p2: 50 },
    past: [],
    selected: null,
  })

  it('gives a level what it needs from above, and lets it write there in the same update', () => {
    const store = createTestStore(doc, docActionSet)
    const states: Doc[] = []
    store.actions.page('p2').item('c').moveTo(80)
    states.push(store.state)
    expect(store.state.pages[1]!.items[0]!.x).toBe(40)
    expect(store.state.past).toHaveLength(1)
    expect(store.state.past[0]![1]!.items[0]!.x).toBe(0)
    store.actions.page('p1').item('b').pick()
    expect(store.state.selected).toBe('b')
    store.actions.page('p1').clear()
    expect(store.state).toMatchObject({ selected: null, past: { length: 2 } })
    store.actions.undo()
    expect(store.state.pages[0]!.items).toHaveLength(2)
    expect(states[0]!.pages[0]).toBe(store.state.pages[0])
  })
  it('does nothing, context included, when the level is gone', () => {
    const store = createTestStore(doc, docActionSet)
    const before = store.state
    store.actions.page('p1').item('gone').moveTo(5)
    expect(store.state).toBe(before)
  })
  it('requires a context where the parent can’t provide one, and checks what it provides', () => {
    // @ts-expect-error a page's context has no pageWidth
    defineActions({ f(this: PageContext, _: Page) {} }, (narrow) => ({ item: narrow((p, id: string) => p.items.find((i) => i.id === id), itemActionSet) }))
    // An item set that only needs Editing takes its parent's context as it is.
    const pick = defineActions({
      pick(this: Editing, it: Item) {
        this.select(it.id)
      },
    })
    defineActions({ f(this: PageContext, _: Page) {} }, (narrow) => ({ item: narrow((p, id: string) => p.items.find((i) => i.id === id), pick) }))
    defineActions({ f(_: Doc) {} }, (narrow) => ({
      // @ts-expect-error missing checkpoint and select
      page: narrow((d, id: string) => d.pages.find((p) => p.id === id), pageActionSet, () => ({ width: 1 })),
    }))
  })
  it('needs withContext to call a set that needs a context directly, or to make it a root', () => {
    const it0 = { id: 'a', x: 0, w: 10 }
    let checkpoints = 0
    const items = withContext(itemActionSet, { pageWidth: 20, checkpoint: () => void checkpoints++, select: () => {} })
    expect(items.moveTo(it0, 50).x).toBe(10)
    expect(checkpoints).toBe(1)
    expect(createTestStore(it0, items).state).toBe(it0)
    void (() => {
      // @ts-expect-error needs a context
      itemActionSet.moveTo(it0, 1)
      // @ts-expect-error needs a context
      createTestStore(it0, itemActionSet)
      // @ts-expect-error needs a context
      useNewStore(it0, itemActionSet)
    })
  })
  it('works with nested NarrowLists, re-rendering only the item that changed', () => {
    const renders: Record<string, number> = {}
    let a!: BoundActions<typeof docActionSet>
    const getPageId = (p: Page) => p.id
    const getItemId = (i: Item) => i.id
    const renderItem = (i: Item) => {
      renders[i.id] = (renders[i.id] ?? 0) + 1
      return <span>{i.x}</span>
    }
    const renderPage = (p: Page, page: BoundActions<typeof pageActionSet>) => {
      renders[p.id] = (renders[p.id] ?? 0) + 1
      return (
        <NarrowList items={p.items} getKey={getItemId} actions={page.item}>
          {renderItem}
        </NarrowList>
      )
    }
    function Comp() {
      const [d, actions] = useNewStore(doc, docActionSet)
      a = actions
      return (
        <NarrowList items={d.pages} getKey={getPageId} actions={actions.page}>
          {renderPage}
        </NarrowList>
      )
    }
    render(<Comp />)
    act(() => a.page('p1').item('b').nudge())
    expect(renders).toEqual({ p1: 2, a: 1, b: 2, p2: 1, c: 1 })
  })
  it('memoizes a list whose items have no level, with neither setStore nor actions', () => {
    const renders: Record<string, number> = {}
    let a!: BoundActions<typeof docActionSet>
    const getPageId = (p: Page) => p.id
    const renderPage = (p: Page, key: string) => {
      renders[key] = (renders[key] ?? 0) + 1
      return <span data-testid={key}>{p.items.length}</span>
    }
    function Comp() {
      const [d, actions] = useNewStore(doc, docActionSet)
      a = actions
      return (
        <NarrowList items={d.pages} getKey={getPageId}>
          {renderPage}
        </NarrowList>
      )
    }
    render(<Comp />)
    act(() => a.page('p2').clear())
    expect(screen.getByTestId('p2').textContent).toBe('0')
    expect(renders).toEqual({ p1: 1, p2: 2 })
  })
})

// Nothing here is a global store: every store made from the same set or the same context definition is its own.
describe('many stores of the same definition', () => {
  it('keeps hook stores made from the same set apart', () => {
    const stores: Record<string, { state: S; actions: App }> = {}
    function Comp({ name }: { name: string }) {
      const [state, actions] = useNewStore(init, appActionSet)
      stores[name] = { state, actions }
      return null
    }
    render(
      <>
        <Comp name="a" />
        <Comp name="b" />
      </>,
    )
    act(() => stores.a!.actions.todos.item(0).toggle())
    act(() => stores.b!.actions.rename('b'))
    expect(stores.a!.state.todos[0]!.done).toBe(true)
    expect(stores.a!.state.title).toBe('t')
    expect(stores.b!.state.todos[0]!.done).toBe(false)
    expect(stores.b!.state.title).toBe('b')
    expect(stores.a!.actions).not.toBe(stores.b!.actions)
  })
  it('keeps test stores made from the same set apart', () => {
    const a = createTestStore(init, appActionSet)
    const b = createTestStore(init, appActionSet)
    a.actions.todos.add(5, 'e')
    expect(a.state.todos).toHaveLength(3)
    expect(b.state.todos).toHaveLength(2)
  })
  it('keeps Providers of the same action context apart, side by side and nested, narrowed contexts included', () => {
    const ctx = createContextStore(appActionSet)
    const todoCtx = createNarrowedStoreContext(ctx, (a, id: number) => a.todos.item(id))
    const seen: Record<string, { title: string; done: boolean; actions: App; todoActions: BoundActions<typeof todoActionSet> }> = {}
    function Probe({ name }: { name: string }) {
      seen[name] = {
        title: ctx.useVal().title,
        done: todoCtx.useVal().done,
        actions: ctx.useActions(),
        todoActions: todoCtx.useActions(),
      }
      return null
    }
    render(
      <>
        <ctx.Provider initial={init}>
          <todoCtx.Provider narrowArg={0}>
            <Probe name="a" />
          </todoCtx.Provider>
          <ctx.Provider initial={() => ({ ...init(), title: 'inner' })}>
            <todoCtx.Provider narrowArg={0}>
              <Probe name="inner" />
            </todoCtx.Provider>
          </ctx.Provider>
        </ctx.Provider>
        <ctx.Provider initial={init}>
          <todoCtx.Provider narrowArg={0}>
            <Probe name="b" />
          </todoCtx.Provider>
        </ctx.Provider>
      </>,
    )
    expect([seen.a!.title, seen.inner!.title, seen.b!.title]).toEqual(['t', 'inner', 't'])
    act(() => seen.a!.todoActions.toggle())
    act(() => seen.inner!.actions.rename('changed'))
    expect([seen.a!.done, seen.inner!.done, seen.b!.done]).toEqual([true, false, false])
    expect([seen.a!.title, seen.inner!.title, seen.b!.title]).toEqual(['t', 'changed', 't'])
  })
  it('keeps Providers of the same setter context apart, narrowed contexts included', () => {
    const ctx = createContextStore<S>()
    const todoCtx = createNarrowedStoreContext(ctx, (s, id: number) => s.todos.find((t) => t.id === id))
    const seen: Record<string, { done: boolean; setTodo: (fn: (t: Todo) => void) => void }> = {}
    function Probe({ name }: { name: string }) {
      const setTodo = todoCtx.useSet()
      seen[name] = { done: todoCtx.useVal().done, setTodo: (fn) => setTodo((t) => void fn(t)) }
      return null
    }
    render(
      <>
        <ctx.Provider initial={init}>
          <todoCtx.Provider narrowArg={1}>
            <Probe name="a" />
          </todoCtx.Provider>
        </ctx.Provider>
        <ctx.Provider initial={init}>
          <todoCtx.Provider narrowArg={1}>
            <Probe name="b" />
          </todoCtx.Provider>
        </ctx.Provider>
      </>,
    )
    act(() => seen.b!.setTodo((t) => (t.done = true)))
    expect([seen.a!.done, seen.b!.done]).toEqual([false, true])
  })
  it('keeps NarrowLists over stores from the same set apart', () => {
    const rows: Record<string, TodoLevel> = {}
    const getId = (t: Todo) => t.id
    function Comp({ name }: { name: string }) {
      const [state, actions] = useNewStore(init, appActionSet)
      return (
        <>
          <span data-testid={name}>{state.todos.map((t) => (t.done ? 'x' : '-')).join('')}</span>
          <NarrowList items={state.todos} getKey={getId} actions={actions.todos.item}>
            {(t: Todo, todoActions: TodoLevel) => {
              rows[`${name}${t.id}`] = todoActions
              return null
            }}
          </NarrowList>
        </>
      )
    }
    render(
      <>
        <Comp name="a" />
        <Comp name="b" />
      </>,
    )
    act(() => rows.b1!.toggle())
    expect(screen.getByTestId('a').textContent).toBe('--')
    expect(screen.getByTestId('b').textContent).toBe('-x')
  })
})

describe('useNarrowedStore with an action store', () => {
  it('pairs a value with its actions from one pick, for items side by side', () => {
    let first!: Todo
    let second!: Todo
    let firstActions!: TodoLevel
    let secondActions!: TodoLevel
    function Comp() {
      const [app, appActions] = useNewStore(init, appActionSet)
      ;[first, firstActions] = useNarrowedStore(app, (a) => a.todos.item(0), appActions)
      ;[second, secondActions] = useNarrowedStore(app, (a) => a.todos.item(1), appActions)
      expectTypeOf(first).toEqualTypeOf<Todo>()
      return null
    }
    render(<Comp />)
    expect([first.text, second.text]).toEqual(['a', 'b'])
    act(() => secondActions.toggle())
    expect([first.done, second.done]).toEqual([false, true])
    act(() => firstActions.setText('A'))
    expect(first.text).toBe('A')
  })
  it('keeps the level while it leads to the same item, and swaps it when the pick changes', () => {
    const levels: TodoLevel[] = []
    let setId!: (id: number) => void
    let appActions!: App
    function Comp() {
      const [id, setIdState] = useState(0)
      setId = setIdState
      const [app, actions] = useNewStore(init, appActionSet)
      appActions = actions
      const [, todoActions] = useNarrowedStore(app, (a) => a.todos.item(id), actions)
      levels.push(todoActions)
      return null
    }
    render(<Comp />)
    act(() => appActions.rename('x'))
    expect(levels.at(-1)).toBe(levels[0])
    act(() => setId(1))
    expect(levels.at(-1)).not.toBe(levels[0])
    act(() => appActions.rename('y'))
    expect(levels.at(-1)).toBe(levels.at(-2))
  })
  it('throws when the picked item is missing, like the setter form', () => {
    function Comp() {
      const [app, appActions] = useNewStore(init, appActionSet)
      useNarrowedStore(app, (a) => a.todos.item(99), appActions)
      return null
    }
    expect(() => render(<Comp />)).toThrow(/missing/)
  })
})
