# narrow

`useState` for nested data. Mutate it like a plain object, keep it as plain immutable React state, and hand any component just the slice it needs.

If you've used `useImmer`, the mutation part is familiar. `narrow` adds what comes next: narrowing, so a component gets its slice and a setter that writes back into the store, and context stores that keep components that only write from re-rendering.

No global store, no selectors, no actions. State is plain data that lives in your component tree and flows through props and context, so React and the React Compiler treat it like any other state. Writes go through [Mutative](https://github.com/unadlib/mutative), which turns your mutations into immutable updates.

> **Warning:** `narrow` is still a 0.x release, so the API may change. Found a bug, or a case it doesn't handle? Please [open an issue](https://github.com/jaaamesey/narrow/issues).

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

## First, create a store

It works like `useState`, except a function you pass to the setter mutates a draft.

```tsx
import { useNewStore } from 'narrow'

function TodoApp() {
  const [state, setState] = useNewStore({ title: 'Todos', todos: [] as Todo[] })

  const add = (title: string) =>
    setState((s) => {
      s.todos.push({ id: crypto.randomUUID(), title, done: false })
    })
  // ...
}
```

To replace the state instead, pass a value, or a function with `'swap'`:

```ts
setState({ title: 'Todos', todos: [] })
setState((s) => ({ ...s, todos: [] }), 'swap')
```

Returning a new object from a mutating function is a type error, so a forgotten `'swap'` doesn't slip through.

## Then narrow it

A todo row shouldn't need the whole app's state. Narrow the store, and the row gets its todo and a setter that writes back into the store. The row stays reusable, its updates are one line, and it doesn't re-render when other todos change (requires the React Compiler, or a `useCallback`).

```tsx
const [todos, setTodos] = useNarrowedStore(state, (s) => s.todos, setState)

<NarrowList items={todos} setStore={setTodos} getKey={(t) => t.id}>
  {(todo, setTodo) => <TodoRow todo={todo} setTodo={setTodo} />}
</NarrowList>

function TodoRow({ todo, setTodo }: { todo: Todo; setTodo: SetStore<Todo> }) {
  return <input type="checkbox" checked={todo.done} onChange={() => setTodo((t) => { t.done = !t.done })} />
}
```

`NarrowList` gives each item its own narrowed store and re-renders only the items that changed. A narrowed store works like any other, so you can narrow it again.

## Share it through context

```tsx
const appStore = createContextStore<AppState>()

<appStore.Provider initial={…}>…</appStore.Provider>

const state = appStore.useVal()     // re-renders when the state changes
const setState = appStore.useSet()  // doesn't
```

Narrowed contexts only re-render their consumers when their slice changes:

```tsx
const settingsStore = createNarrowedStoreContext(appStore, (s) => s.settings)

<settingsStore.Provider>…</settingsStore.Provider>
```

### Why narrow over useState, useImmer and context?

- Components get their slice of the state and a setter for it, not all of it
- Components that only write don't re-render when the state changes
- Nested updates are one line, as with `useImmer`

### Why narrow over Zustand, Jotai or Valtio?

- It's React state: plain values in your component tree, not module-level stores, atoms or proxies
- Components receive a slice and a setter instead of reaching into a store by path
- Lists re-render only the item that changed, without selectors or `memo` (requires the React Compiler, or a `useCallback`)

---

# Recipes

## Narrowing to an item picked at runtime

Give the narrow function a second parameter, and pass it to the Provider:

```tsx
const todoStore = createNarrowedStoreContext(appStore, (s, id: string) => s.todos.find((t) => t.id === id)!)

<todoStore.Provider narrowArg={selectedId}>…</todoStore.Provider>
```

## When a narrow function can't be traced

Writes work out where the narrowed data lives by tracing the narrow function. Identity checks (`t === ref`), Map lookups and computed values can't be traced, so the write throws. Pass `get` and `swap` instead:

```ts
useNarrowedStore(state, { get: (s) => s.byId.get(id)!, swap: (d, todo) => { d.byId.set(id, todo) } }, setState)
```

## Without the React Compiler

Wrap inline narrow functions and `NarrowList` children in `useCallback`, or pass dependencies to the hook:

```ts
useNarrowedStore(state, (s) => s.todos[i], setState, [i])
```

## Things to know

- Reading narrowed data that no longer exists throws. Writing to it does nothing, so late async callbacks are safe.
- Following Mutative, plain objects, arrays, Maps and Sets can be mutated. Dates and class instances are replaced, not mutated.

## Example

[`examples/todomvc`](examples/todomvc) is TodoMVC built with `narrow` and the React Compiler, with no `memo`.

```sh
npm install && npm run dev -w examples/todomvc
```
