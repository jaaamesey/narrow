# narrow

React state for nested data. Keep one store, then **narrow** it: give any component just the piece it needs (a todo, a form section, the settings) along with a setter that writes that piece back into the store.

- **Encapsulated:** a component sees only its own slice, not the whole app state.
- **Fast:** editing one item re-renders only the components that read it. Untouched data keeps its identity (structural sharing), so React and the [React Compiler](https://react.dev/learn/react-compiler) skip the rest. No selectors and no manual `memo`.
- **Simple writes:** update with plain mutations (`t.done = true`). [Mutative](https://github.com/unadlib/mutative) turns them into immutable updates.

Values are plain immutable objects, with no proxies when reading. Typed end to end with TypeScript.

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
- **Without the React Compiler**, wrap inline narrow functions in `useCallback` to keep their setters stable, or pass dependencies: `useNarrowedStore(store, fn, setStore, [id])`.

## How other libraries compare

Take a todo row that shows and edits one todo, in a list where other todos are also changing:

| | What the row receives | How the row toggles its todo | Does the row know where its todo lives in the state? | Do edits to *other* todos re-render it? |
|---|---|---|---|---|
| **`narrow`** | `todo`, `setTodo` | `setTodo((t) => { t.done = !t.done })` | No | No¹ |
| **`useState` + context** | `todo`, plus a callback for each kind of edit (`onToggle`, `onRename`, …) passed down through every layer | The owner rebuilds the path: `todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t))` | No, but every owner above it does | Yes, unless you split contexts or memoize by hand |
| **Zustand** | An id | Calls a store action, `toggle(id)` | Yes: `useStore((s) => s.todos.find((t) => t.id === id))` | No (selector) |
| **Jotai** (`splitAtom`) | An atom for its todo | `setTodo((t) => ({ ...t, done: !t.done }))` | No | No |
| **MobX** | The todo itself, as an observable | `todo.done = !todo.done` | No | No (tracked reads in `observer` components) |
| **Valtio** | The todo's proxy, read through `useSnapshot` | `todo.done = !todo.done`, on the proxy | No | No (tracked reads) |

¹ Untouched todos keep their identity (structural sharing), and each row's setter is stable, so `NarrowList` skips those rows.

**Where they differ from `narrow`:**
- **Zustand** stores are global, usable outside React, and have devtools and middleware. The price is that components are wired to one store's shape, so the same row can't be reused for a todo stored somewhere else.
- **Jotai** is the closest match. Its state is a graph of atoms (good for derived and async values) rather than one plain object tree, and writes are spreads unless you add `jotai-immer`.
- **MobX** lets you skip the setter entirely, but observables are edited in place, so their identity never changes. React's memoization, effect dependencies and the React Compiler compare identity, so they can't see those edits; you rely on `observer` instead. With `narrow`, every edit produces new immutable values.
- **Valtio** reads from immutable snapshots and writes to a proxy, so a row holds two references, much like `narrow`'s value and setter. Its state lives in proxies created outside React (usually at module level). `narrow` state is ordinary React state, so each mounted tree gets its own.
- **`narrow`** is new and React-only, with no devtools or middleware, and its stores live in the component tree.

## Example

[`examples/todomvc`](examples/todomvc) is the standard TodoMVC app, built with the React Compiler and no `memo`.

```sh
npm install && npm run dev -w examples/todomvc
```

`npm test` · `npm run typecheck`
