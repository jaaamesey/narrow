# react-narrow

`useState` for nested data. Mutate it like a plain object, keep it as plain immutable React state, and hand any component just the slice it needs.

No global store, no selectors, no actions. State is plain data that lives in your component tree and flows through props and context, so React and the React Compiler treat it like any other state. Writes go through [Mutative](https://github.com/unadlib/mutative), which turns your mutations into immutable updates.

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

That's what makes components small. A todo row doesn't need the whole app's state, just its todo and a setter for it. It stays reusable, its updates are one line, and it doesn't re-render when other todos change (requires the React Compiler, or a `useCallback`). `NarrowList` does this for every item in a list:

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

## Why react-narrow?

### Over useState and context

- Nested updates are a one-line mutation, not a spread at every level
- Components get their slice of the state and a setter for it, not all of it
- Value and setter come in separate contexts, so components that only write don't re-render, without splitting contexts by hand

### Over useImmer

- Hand a child its slice and a setter that writes back, instead of the parent's whole state or a callback for every kind of edit
- Context stores are built in, including narrowed contexts that only re-render for their slice
- `NarrowList` gives every list item its own stable setter, so unchanged items skip re-rendering (requires the React Compiler, or a `useCallback`). With `useImmer`, you'd pass ids and stable callbacks by hand

### Over Zustand, Jotai or Valtio

- It's React state: plain values in your component tree, not module-level stores, atoms or proxies
- Updates are ordinary `useState` updates, so they batch and work with transitions. Stores read through `useSyncExternalStore`, like Zustand and Valtio, fall back to blocking updates inside a transition
- Components receive a slice and a setter instead of reaching into a store by path

## Details

### Narrowing to an item picked at runtime

Give the narrow function a second parameter, and pass it to the Provider:

```tsx
const todoStore = createNarrowedStoreContext(appStore, (s, id: string) => s.todos.find((t) => t.id === id))

<todoStore.Provider narrowArg={selectedId}>…</todoStore.Provider>
```

`narrowArg` is compared like a hook dependency, so pass an id or index rather than an object literal.

### When a narrow function can't be traced

Writes work out where the narrowed data lives by tracing the narrow function. Identity checks (`t === ref`), Map lookups and computed values can't be traced, so the update throws when React applies it, and the nearest error boundary catches it. Pass `get` and `swap` instead:

```ts
useNarrowedStore(state, { get: (s) => s.byId.get(id)!, swap: (d, todo) => { d.byId.set(id, todo) } }, setState)
```

### Without the React Compiler

Wrap inline narrow functions, and `NarrowList`'s `getKey` and `children`, in `useCallback`. Otherwise their setters are rebuilt on every render, and list items can't skip re-rendering.

### Edge cases

- Setter functions run as React state updaters, so like `useState` updaters they must be pure. Strict Mode calls them twice.
- Index keys (`getKey={(_, i) => i}`) need the full array as `items`. With a filtered list, the indexes point at the wrong items.
- Reading narrowed data that no longer exists throws. Writing to it does nothing, so late async callbacks are safe.
- Following Mutative, plain objects, arrays, Maps and Sets can be mutated. Dates and class instances are replaced, not mutated.

## Example

[`examples/todomvc`](examples/todomvc) is TodoMVC built with `react-narrow` and the React Compiler, with no `memo`.

```sh
npm install && npm run dev -w examples/todomvc
```
