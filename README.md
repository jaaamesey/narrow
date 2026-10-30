# react-narrow

`useState` for nested data. Mutate it like a plain object, keep it as plain immutable React state, and hand any component just the slice it needs.

No global store, no selectors, no reducers. State is plain data that lives in your component tree and flows through props and context, so React and the React Compiler treat it like any other state. Writes go through [Mutative](https://github.com/unadlib/mutative), which turns your mutations into immutable updates.

```tsx
// Before: rebuild every level by hand
setState((s) => ({
  ...s,
  projects: s.projects.map((p, i) =>
    i === pi ? { ...p, tasks: p.tasks.map((t, j) => (j === ti ? { ...t, done: true } : t)) } : p,
  ),
}))

// After
setState((s) => { s.projects[pi].tasks[ti].done = true })
```

> **Warning:** `react-narrow` is still a 0.x release, so the API may change. Found a bug, or a case it doesn't handle? Please [open an issue](https://github.com/jaaamesey/narrow/issues).

## First, create a store

It works like `useState`, except a function you pass to the setter mutates a draft.

```tsx
import { useNewStore } from 'react-narrow'

function TodoApp() {
  const [state, setState] = useNewStore({ todos: [] as Todo[], settings: { showDone: true } })

  const add = (title: string) =>
    setState((s) => {
      s.todos.push({ id: crypto.randomUUID(), title, done: false })
    })
  // ...
}
```

To replace the state instead, pass a value, or a function with `'swap'`:

```ts
setState({ todos: [], settings: { showDone: true } })
setState((s) => ({ ...s, todos: [] }), 'swap')
```

Returning a new object from a mutating function is a type error, so a forgotten `'swap'` doesn't slip through.

## Then narrow it

Narrowing gives you one part of the state and a setter for just that part. Writes still land in the original store.

```tsx
const [settings, setSettings] = useNarrowedStore(state, (s) => s.settings, setState)

setSettings((s) => { s.showDone = false })  // updates state.settings.showDone
```

`(s) => s.settings` is the narrow function: it picks the part of the state to narrow to. A narrowed store works like any other, so you can pass it down and narrow it again.

You can use `NarrowList` to pass just a single item in a store down to a component. This helper doesn't just isolate reads/writes to that item. Here (assuming you've enabled the React Compiler, or are manually memoizing), it also ensures that a `TodoRow` only re-renders when its own `todo` changes.

```tsx
const [todos, setTodos] = useNarrowedStore(state, (s) => s.todos, setState)

<NarrowList items={todos} setStore={setTodos} getKey={(t) => t.id}>
  {(todo, setTodo) => <TodoRow todo={todo} setTodo={setTodo} />}
</NarrowList>

function TodoRow({ todo, setTodo }: { todo: Todo; setTodo: SetStore<Todo> }) {
  return <input type="checkbox" checked={todo.done} onChange={() => setTodo((t) => { t.done = !t.done })} />
}
```

`NarrowList` also takes a record or a `Map`, for normalized state. Those are keyed already, so there's no `getKey`. `children` gets each entry's key as a third argument.

For a list whose items aren't written to on their own, leave out `setStore`: each item is still memoized, and `children` gets the item and its key.

## Share it through context

```tsx
const appStore = createContextStore<AppState>()

<appStore.Provider initial={…}>…</appStore.Provider>              // the Provider owns a new store
<appStore.Provider store={state} setStore={setState}>…</appStore.Provider>  // or share one from useNewStore

const state = appStore.useVal()     // re-renders when the state changes
const setState = appStore.useSet()  // doesn't
```

Narrowed contexts only re-render their consumers when their slice changes:

```tsx
const settingsStore = createNarrowedStoreContext(appStore, (s) => s.settings)

<settingsStore.Provider>…</settingsStore.Provider>  // settingsStore.useVal() / useSet() inside
```

## Actions

For apps that want every change to go through named, typed, testable functions, any store can take an action set instead of a setter. Its actions are then the only way to write:

```ts
export const counterActionSet = defineActions({
  add(s: Counter, n: number) {
    s.count += n
  },
})

const [counter, counterActions] = useNewStore({ count: 0 }, counterActionSet)
counterActions.add(1)
```

Action sets narrow to other action sets, so each part of the state gets only its own actions, and called directly, every action is a pure function to test. See [Actions](docs/actions.md).

## Testing

Components take their part of the state and a setter as props, so they test with plain values. `createTestStore` is a store that lives outside React: `state` is always the latest value, and writes apply at once.

```tsx
const store = createTestStore(todo)
render(<TodoRow todo={store.state} setTodo={store.set} />)
fireEvent.click(screen.getByRole('checkbox'))
expect(store.state.done).toBe(true)
```

Components don't re-render when it changes, so it's only for tests: to see the new state in the DOM, render again with `store.state`. A component that reads from context renders inside its Provider, with the state to start from:

```tsx
render(
  <appStore.Provider initial={{ todos: [a, b] }}>
    <TodoList />
  </appStore.Provider>,
)
```

For testing actions, see [Actions](docs/actions.md#testing).

## Why react-narrow?

### What it's particularly useful for
- Relatively deep, global-ish state that's frequently written to
- Document editors: slide decks, whiteboards, diagrams, page builders
- Builders: forms, surveys, workflows, product configurators
- Large editable tables and lists: spreadsheets, Kanban boards, outliners
- Timeline and layout editors: video, scheduling, floor plans, game levels

### Where it's less useful
- Data fetching (seriously, use react-query or something for that)
- Anywhere outside of React (like `useState`, you can only pass down data and callbacks from the component tree)
- Wherever extremely fine-grained rendering is needed (use a signals-based state library for that, or avoid React entirely)
- Codebases that don't have the React Compiler enabled (a lot of the library's ergonomics lean on it)

### Why use this over useState and context?

- A deep update is one line, not a spread at every level, where missing one level silently drops data
- A child gets its slice and a setter scoped to it. It can make any edit to that slice, can't touch anything else, and doesn't need to know where the slice lives
- Value and setter come in separate contexts, so components that only write never re-render. Put `[state, setState]` in one context and every consumer re-renders on every change

### Why use this over useImmer?

- `useImmer` makes the top-level update easy, but a child still needs the whole state or a callback for every kind of edit (`onToggle`, `onRename`, …). Here it gets `[todo, setTodo]` and makes the edit itself
- Context stores are built in, so you don't hand-roll a provider and a memoized value. Narrowed contexts re-render only for their slice
- `NarrowList` gives every item a stable setter, so unchanged rows skip re-rendering (with the React Compiler, or `useCallback`). With `useImmer`, you'd thread ids and memoized callbacks through by hand to get the same result

### Why use this over Zustand, Jotai or Valtio?

- It's React state: it still lives in your component tree, behaves exactly as React would expect (making it safe with concurrent and compiler features), and doesn't need snapshots to be taken 
- Updates are ordinary `useState` updates, so they batch and work with transitions. Zustand and Valtio read through `useSyncExternalStore`, so an update inside `startTransition` still blocks
- Components take a slice and a setter as props, so they work with any store and test with plain values, instead of being wired to one global store by path


## Reading the pre-edit value in a recipe

`original` and `current` are re-exported from Mutative, so you don't need to depend on it yourself. Inside a mutating function, `original(draft)` is the value from before the edit and `current(draft)` is a snapshot of the draft so far. They only work on drafts from the same copy of Mutative that `react-narrow` uses, which is why they come from here.

```ts
import { original } from 'react-narrow'

// Only apply this write if the slice hasn't been replaced since `basis` was read
setSlice((s) => {
  if (original(s) !== basis) return
  s.title = result
})
```

## Narrowing to an item picked at runtime

Give the narrow function a second parameter, and pass it to the Provider:

```tsx
const todoStore = createNarrowedStoreContext(appStore, (s, id: string) => s.todos.find((t) => t.id === id))

<todoStore.Provider narrowArg={selectedId}>…</todoStore.Provider>
```

## Edge cases

- Setter functions run as React state updaters, so like `useState` updaters they must be pure. Strict Mode calls them twice.
- Index keys (`getKey={(_, i) => i}`) need the full array as `items`. With a filtered list, the indexes point at the wrong items.
- Reading narrowed data that no longer exists throws. Writing to it does nothing, so late async callbacks are safe.
- Following Mutative, plain objects, arrays, Maps and Sets can be mutated. Dates and class instances are replaced, not mutated.

## Examples

- [`examples/slides`](examples/slides): a slide deck editor. Dragging a shape re-renders only that shape and its slide's thumbnail.
- [`examples/todomvc`](examples/todomvc): TodoMVC.
- [`examples/todomvc-actions`](examples/todomvc-actions): the same TodoMVC, with its updates written as actions.

All of them use the React Compiler and no `memo`. Run one with `npm install && npm run dev -w examples/slides`.
