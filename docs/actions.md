# Actions

[← react-narrow](../README.md)

For apps that want every change to their state to go through named, typed, testable functions: an editor with undo, a big form builder, anything where "who can change what" matters. Any store can take named actions instead of a setter, to restrict the ways in which state can change. It then has no setter, so its actions are the only way to write, and each part of the state only gets the actions for that part.

If a setter you can narrow is enough, you don't need any of this.

## Defining actions

Make an action set with `defineActions`: each action takes the state first, then mutates it or returns a replacement for it. Then pass it as the last argument wherever you'd make a store: `useNewStore` or `createContextStore` (or `createTestStore`, in tests).

```ts
// counter.ts
import { defineActions } from 'react-narrow'

type Counter = { count: number }

export const counterActionSet = defineActions({
  add(s: Counter, n: number) {
    s.count += n
  },
  // Returning a value replaces the state
  reset(_: Counter) {
    return { count: 0 }
  },
})
```

```tsx
import { useNewStore } from 'react-narrow'
import { counterActionSet } from './counter'

function Counter() {
  const [counter, counterActions] = useNewStore({ count: 0 }, counterActionSet)
  return <button onClick={() => counterActions.add(1)}>{counter.count}</button>
}
```

Types come from the actions: the state type is their first parameter, `initial` is checked against it, and `counterActions.add` takes `(n: number)`. Write actions as methods, as above. In one that doesn't declare a `this` (see below), `this` is `unknown`, so it can't be mistaken for the set.

Name an action set `xActionSet`, and the actions bound to a store `xActions`, next to its state, like `[x, setX]` for `useState`: `const [todos, todoActions] = useNewStore(initial, todoActionSet)`.

For a big set, or a state with class instances or typed arrays in it (whose drafts aren't the same type as them), give the state type up front instead. Each action's state parameter is then typed for you, as a `Draft` of it, which also suits helper functions that take drafts:

```ts
export const editorActionSet = defineActions<EditorState>()({
  setTool(d, tool: Tool) {
    d.tool = tool
  },
  removeSelected(d) {
    removeItem(d, d.selectedId)
  },
})
```

Given up front, a set can also have no actions of its own (`defineActions<State>()({}, children)`), just narrowed levels.

## Narrowing an action store

There's no setter to narrow, so the narrowing that writes is declared with the actions. An action set can narrow to other action sets, each for its own part of the state, and those can narrow further, to any depth:

```ts
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
  },
  (narrow) => ({ tag: narrow((t, i: number) => t.tags[i], tagActionSet) }),
)

const appActionSet = defineActions(
  {
    add(s: AppState, id: string, title: string) {
      s.todos.push({ id, title, done: false, tags: [] })
    },
  },
  (narrow) => ({
    // A level that takes an argument
    todo: narrow((s, id: string) => s.todos.find((t) => t.id === id), todoActionSet),
    // A level with no actions of its own, just levels below it
    board: narrow(
      (s, id: string) => s.boards.find((b) => b.id === id),
      defineActions<Board>()({}, (narrow) => ({
        todo: narrow((b, id: string) => b.todos.find((t) => t.id === id), todoActionSet),
      })),
    ),
  }),
)

const [app, appActions] = useNewStore(initial, appActionSet)

appActions.add(id, 'Milk')
appActions.todo(id).toggle()
appActions.todo(id).tag(0).rename('dairy')
appActions.board(boardId).todo(id).toggle()
```

The narrow function is checked against the set it narrows to, so picking the wrong set, or a property that isn't there, is a type error. A set can be used at any number of places, like `todoActionSet` above. `appActions.todo(id)` binds a new level each call. To get one that keeps its identity across renders, along with its value, use `NarrowList` for a list, or `useNarrowedStore` (below) for one item.

For recursive data, like an outline, a set narrows to itself. TypeScript can't infer a type that contains itself, so write that one out:

```ts
const nodeFns = {
  setText(n: OutlineNode, text: string) {
    n.text = text
  },
}
type NodeChildren = { child: NarrowedActions<number, OutlineNode, typeof nodeFns, NodeChildren> }

const outlineActionSet: ActionSet<OutlineNode, typeof nodeFns, NodeChildren> = defineActions(nodeFns, (narrow) => ({
  child: narrow((n, i: number) => n.children[i], outlineActionSet),
}))
// outlineActions.child(0).child(2).setText(…)
```

`NarrowList` takes a level instead of a setter, and gives each item its actions. Lists nest: a page's `NarrowList` can take `pageActions.item`.

```tsx
<NarrowList items={app.todos} getKey={(t) => t.id} actions={appActions.todo}>
  {(todo, todoActions) => <TodoRow todo={todo} todoActions={todoActions} />}
</NarrowList>

function TodoRow({ todo, todoActions }: { todo: Todo; todoActions: BoundActions<typeof todoActionSet> }) {
  return <input type="checkbox" checked={todo.done} onChange={() => todoActions.toggle()} />
}
```

For a list whose items have no level, leave out both `setStore` and `actions`: each item is still memoized, and `children` gets the item and its key.

## One level in a component

To show one item, or two side by side, pick its level with `useNarrowedStore`, as you'd narrow a setter store. It returns the level's value and its actions from the one pick, so the two can't come from different items:

```tsx
function Compare({ app, appActions, leftId, rightId }: Props) {
  const [left, leftActions] = useNarrowedStore(app, (a) => a.todo(leftId), appActions)
  const [right, rightActions] = useNarrowedStore(app, (a) => a.todo(rightId), appActions)
  return (
    <>
      <TodoRow todo={left} todoActions={leftActions} />
      <TodoRow todo={right} todoActions={rightActions} />
    </>
  )
}
```

Like a setter store's narrowed setter, the level keeps its identity while the pick function does: the React Compiler keeps an inline one stable, or use `useCallback`. Like the setter form, it throws if the item is missing.

## What a level needs from above

A level's actions only get their own part of the state. When they need more, like the page an item is on, a way to record an undo step, or the selection, the set declares it as its actions' `this`, and the level that narrows to it provides it:

```ts
type ItemContext = { pageWidth: number; checkpoint(): void; select(id: string | null): void }

const itemActionSet = defineActions({
  moveTo(this: ItemContext, it: Item, x: number) {
    this.checkpoint()
    it.x = Math.min(x, this.pageWidth - it.w)
  },
  pick(this: ItemContext, it: Item) {
    this.select(it.id)
  },
})

const docActionSet = defineActions<Doc>()({ … }, (narrow) => ({
  item: narrow(
    (d, id: string) => findItem(d, id),
    itemActionSet,
    // Called when an item action runs, with the document's draft: what it does there is part of the same update
    (d, id) => ({
      pageWidth: pageOf(d, id).width,
      checkpoint: () => void d.past.push(original(d.pages)),
      select: (id) => void (d.selected = id),
    }),
  ),
}))

docActions.item(id).moveTo(40)  // moves the item, and records the undo step, in one update
```

The context provider gets the parent's draft, the narrow function's argument, and the parent's own context. A level whose parent's context already has everything its set needs can leave the provider out, and gets the parent's. Leaving out a context that's needed, or providing one that's missing something, is a type error.

A set that needs a context can't be a store's root, or be called directly, until it has one: `withContext(itemActionSet, { pageWidth: 100, … })` gives it one, which is mostly useful in tests.

## Calling actions directly

An action set's actions can also be called directly. Each takes the state and returns the next state, without changing the one passed in, whether the action mutates or replaces:

```ts
todoActionSet.toggle(todo)   // the toggled todo; `todo` is unchanged
appActionSet.add(app, id, 'Milk')   // the next app state
```

Inside another action, on a draft, an action changes the draft in place, so one action can call another:

```ts
const listActionSet = defineActions({
  toggleAll(todos: Todo[]) {
    for (const t of todos) todoActionSet.toggle(t)
  },
})
```

## Action stores in context

```tsx
const appStore = createContextStore(appActionSet)

<appStore.Provider initial={…}>…</appStore.Provider>                     // owns a new store
<appStore.Provider store={app} actions={appActions}>…</appStore.Provider>  // or shares one from useNewStore

const app = appStore.useVal()               // re-renders when the state changes
const appActions = appStore.useActions()    // doesn't
```

An action set or a context store is only a definition: every `useNewStore` call and every Provider makes its own store, so render as many as you like, side by side or nested. A component reads the nearest Provider above it.

A narrowed context picks a level from its parent's actions. Its consumers only re-render when that level's value changes:

```tsx
const todoStore = createNarrowedStoreContext(appStore, (appActions, id: string) => appActions.todo(id))

<todoStore.Provider narrowArg={selectedId}>…</todoStore.Provider>  // todoStore.useVal() / useActions() inside
```

## Action store notes

- Actions run as state updaters, so they must be pure. Make ids or timestamps outside and pass them in. For the same reason, bound actions return nothing.
- An action that both mutates the state and returns a value throws.
- An action that ignores the state still needs it as its first parameter (`reset(_: Counter)`), since that's where the type comes from.
- Define action sets at module level, not inside a component: a set made during render is new every render, and so are its bound actions.
- A narrow function takes an argument if it declares a second parameter. Don't give that parameter a default value.
- Get a value and its actions from the same place, so they can't come from different items or stores: `useNarrowedStore`, `NarrowList` and narrowed contexts each hand them out together.

## Testing

Nothing here needs React to test.

Called directly, an action is a pure function: it takes the state and returns the next state, and never changes the one you pass in. An action that mutates and one that returns a new state are tested the same way, so changing how an action is written doesn't break its tests:

```ts
expect(todoActionSet.toggle({ id: 1, title: 'a', done: false }).done).toBe(true)
expect(appActionSet.clearDone(app).todos).toEqual([])
```

To run several actions in a row, or a narrowed level's actions, `createTestStore` is a store that lives outside React: `state` is always the latest value, and writes apply at once. Like `useNewStore`, it takes an action set, or gives you a setter without one. Components don't re-render when it changes, so it's only for tests.

```ts
const store = createTestStore({ todos: [] }, appActionSet)
store.actions.add(1, 'a')
store.actions.todo(1).toggle()
expect(store.state.todos).toEqual([{ id: 1, title: 'a', done: true }])
```

Components take values and actions as props, so pass in real ones from a store, or spies:

```tsx
// Real actions: click, then check the state
const store = createTestStore(initial, appActionSet)
render(<TodoRow todo={store.state.todos[0]} todoActions={store.actions.todo(1)} />)
fireEvent.click(screen.getByRole('checkbox'))
expect(store.state.todos[0].done).toBe(true)

// Spies: check which action was called
const todoActions = { toggle: vi.fn(), rename: vi.fn() }
render(<TodoRow todo={todo} todoActions={todoActions} />)
fireEvent.click(screen.getByRole('checkbox'))
expect(todoActions.toggle).toHaveBeenCalledOnce()
```

Props don't follow a store outside React, so to see the new state in the DOM, render again with `store.state`. A component that reads from context renders inside its Provider, with the state to start from:

```tsx
render(
  <appStore.Provider initial={{ todos: [a, b] }}>
    <TodoList />
  </appStore.Provider>,
)
```

[`src/testing.test.tsx`](../src/testing.test.tsx) runs each of these.

## Example

[`examples/todomvc-actions`](../examples/todomvc-actions) is TodoMVC with every update written as an action.
