# narrow

**`useState` for nested data.** Write updates as plain mutations, and get plain immutable state that works the way React expects.

```tsx
// useState: rebuild every level by hand
setState((s) => ({
  ...s,
  projects: s.projects.map((p, i) =>
    i === pi ? { ...p, tasks: p.tasks.map((t, j) => (j === ti ? { ...t, done: true } : t)) } : p,
  ),
}))

// narrow: just change it
setState((s) => { s.projects[pi].tasks[ti].done = true })
```

- **It's just React state.** Immutable values flow through props and context, with no global store, selectors, actions or proxies. It works with the [React Compiler](https://react.dev/learn/react-compiler) out of the box.
- **Context included.** Share a store through a Provider. Components that only write never re-render.
- **Narrow when it helps.** Hand a component just its slice of the state and a setter for it ([below](#narrow-it)).

Built on [Mutative](https://github.com/unadlib/mutative) and fully typed.

## Create a store

```tsx
const [store, setStore] = useNewStore({ title: 'Todos', todos: [] as Todo[] })
```

It works like `useState`: `store` is the current value, and `setStore` is stable. There are three ways to set:

```ts
setStore((s) => { s.title = 'Mine' })                // mutate a draft (the default for functions)
setStore({ title: 'Mine', todos: [] })               // replace the state
setStore((s) => ({ ...s, title: 'Mine' }), 'swap')   // replace, computed from the current state
```

Returning an object from a mutate function is a type error, which catches a forgotten `'swap'`.

## Narrow it

A `TodoItem` shouldn't need the whole app's store. Narrowing hands it just its todo and a setter for that todo:

- **Encapsulation:** it only knows about a `Todo`, so it works wherever a todo lives.
- **Concise code:** it writes `setTodo((t) => { t.done = true })` instead of finding itself in the list.
- **Performance:** `NarrowList` re-renders an item only when that item changes, and a narrowed context re-renders its consumers only when their slice changes. Untouched data keeps its identity (structural sharing), so no selectors are needed.

```tsx
const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[0], setStore)
setTodo((t) => { t.done = true })                    // writes into `store`
```

A narrowed store works like any other store, and you can narrow it again.

For lists, use `NarrowList`. Each item gets its own narrowed store, and only the item that changed re-renders:

```tsx
<NarrowList items={todos} setStore={setTodos} getKey={(t) => t.id}>
  {(todo, setTodo) => <TodoItem todo={todo} setTodo={setTodo} />}
</NarrowList>
```

## Share it with context

```tsx
const appStore = createContextStore<AppState>()        // optional default value

<appStore.Provider initial={…}>…</appStore.Provider>   // or store={store} setStore={setStore}

const state = appStore.useVal()     // re-renders when the state changes
const setState = appStore.useSet()  // stable; never re-renders
```

Narrow a context store to get a context that only re-renders for its slice:

```tsx
const settingsStore = createNarrowedStoreContext(appStore, (s) => s.settings)
<settingsStore.Provider>…</settingsStore.Provider>      // settingsStore.useVal() / useSet() inside

// To pick an item at runtime (e.g. from the URL), take a second parameter:
const todoStore = createNarrowedStoreContext(appStore, (s, id: string) => s.todos.find((t) => t.id === id)!)
<todoStore.Provider narrowArg={selectedId}>…</todoStore.Provider>
```

## Good to know

- **Narrow functions must point at data inside the store.** For example `s.todos[i]` or `s.todos.find((t) => t.id === id)`, not a copy. If `narrow` can't work out where the data lives (identity checks like `t === ref`, Map lookups, computed values), the write throws. In that case, pass `{ get, swap }` instead of a function:
  ```ts
  useNarrowedStore(store, { get: (s) => s.byId.get(id)!, swap: (d, v) => { d.byId.set(id, v) } }, setStore)
  ```
- **Missing data:** reading a narrowed item that no longer exists throws. Writing to it does nothing, so late async callbacks are safe.
- **Mutative's rules apply:** plain objects, arrays, Maps and Sets can be mutated in a setter. Dates and class instances get replaced (`s.when = new Date()`).
- **Without the React Compiler**, wrap inline narrow functions and `NarrowList`'s `children` in `useCallback` to keep them stable, or pass dependencies to the hook: `useNarrowedStore(store, fn, setStore, [id])`.

## How it compares

Most state managers have components reach into a global store with selectors and actions (Zustand, Redux), or split state into atoms or proxies (Jotai, MobX, Valtio). `narrow` keeps one store of plain, immutable data that flows through props and context like `useState`, so React and the React Compiler work as usual. For encapsulation and concise code, narrowed writes give a component a setter for just its slice, so it never sees the rest of the state and updates are one-line mutations like `t.done = true`. For performance, narrowed reads (`NarrowList`, narrowed contexts) re-render only the components whose slice changed.

## Example

[`examples/todomvc`](examples/todomvc) is the standard TodoMVC app, built with the React Compiler and no `memo`.

```sh
npm install && npm run dev -w examples/todomvc
```

`npm test` · `npm run typecheck`
