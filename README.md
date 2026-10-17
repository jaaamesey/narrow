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

Each comparison uses the same example: a `TodoItem` row that toggles its todo.

**`useState` + context**
- The state's owner does the update, `setState((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }))`, and passes a callback down to each row. Every context consumer re-renders on every change.
- With `narrow`, the row gets `setTodo` and writes `t.done = !t.done`. Only that row re-renders.

**Zustand**
- The row needs the todo's id and has to know where todos live in the global store: `useStore((s) => s.todos.find((t) => t.id === id))`, plus a `toggle(id)` action. In exchange, the store is global: any component, or code outside React, can use it without a Provider.
- With `narrow`, the row receives `todo` and `setTodo` and knows nothing else. It works with any store that holds a `Todo`, which makes it easy to reuse and test.

**Jotai**
- `splitAtom` gives each row its own writable atom, much like `NarrowList`, and `focusAtom` (from `jotai-optics`) narrows into an atom. State is modelled as atoms, which suits many independent or async-derived values.
- `narrow` keeps one plain object tree and narrows it with plain functions.

**MobX / Valtio**
- You pass `state.todos[i]` to the row and mutate it directly. The library tracks which properties each component reads and re-renders it when they change.
- `narrow` gives the same "pass the piece down and write to it" style, but state stays plain, immutable React state, and writes go through an explicit setter.

**Where `narrow` is weaker:** it's new and React-only, with no devtools or middleware, and its stores live in the component tree rather than at module level.

## Example

[`examples/todomvc`](examples/todomvc) is the standard TodoMVC app, built with the React Compiler and no `memo`.

```sh
npm install && npm run dev -w examples/todomvc
```

`npm test` · `npm run typecheck`
