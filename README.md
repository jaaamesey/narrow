# narrow

Small React state library built on [Mutative](https://github.com/unadlib/mutative), with first-class **narrowed stores**: a narrowed store is a live projection of another store. Reads go through the parent, writes land in the parent, and it is used exactly like any other store.

```tsx
const [store, setStore] = useNewStore({ title: 'x', todos: [] as Todo[] })
```

`store` is a plain value (re-renders its owner, like `useState`); `setStore` is stable.

## Setting

```ts
setStore((s) => { s.a = 1 })              // mutate (default for functions); must not return a new state
setStore({ a: 1 })                        // swap
setStore((s) => ({ ...s, a: 1 }), 'swap') // swap, with access to the current state
```

Returning an object from a mutate recipe is a **type error**, not a runtime one (return values are ignored). Only `void`/primitives may be returned, so `s => s.a = 1` is fine, but assigning an object needs braces: `s => { s.b = {…} }`.

## Context

```tsx
const storeDef = createContextStore<State>(/* optional default value */)

<storeDef.Provider initial={...}>                       {/* own a new store */}
<storeDef.Provider store={store} setStore={setStore}>   {/* share one from useNewStore */}
const store = storeDef.use()        // value; re-renders on change
const setStore = storeDef.useSet()  // stable, never re-renders
```

Value and setter live in separate React contexts, so setter-only consumers never re-render.

Without a Provider, `use()` returns the default value, like React's `createContext(default)`. It's read-only: calling the setter throws. With no default, both hooks throw.

## Narrowing

A narrowed store is derived from the parent's value, and writes go through the parent's setter, so pass both:

```tsx
const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[i]!, setStore)

<Narrow store={store} setStore={setStore} by={(s) => s.todos[i]!}>
  {(todo, setTodo) => <TodoRow todo={todo} onToggle={() => setTodo((t) => { t.done = !t.done })} />}
</Narrow>

// Leave out the setter and it's read-only (enforced by types): the result is just `[todo]`.
const [todo] = useNarrowedStore(store, (s) => s.todos[i]!)

// Narrowed values/setters narrow further the same way.
const [text, setText] = useNarrowedStore(todo, (t) => t.meta, setTodo)

const todoDef = createNarrowedStoreContext(storeDef, (s, i: number) => s.todos[i]!)
<todoDef.Provider arg={i}><TodoRow /></todoDef.Provider>   // todoDef.use() / useSet() inside
```

- Narrow functions must return an object/array/Map/Set (enforced by types) located *inside* the parent state. The narrowed setter is stable. If `narrowFn` reads an outside value (an id/index), pass it in a deps array like `useMemo`: `useNarrowedStore(store, (s) => s.todos[i]!, setStore, [i])` or `<Narrow … deps={[i]}>`. Narrowed contexts follow their `arg` automatically.
- Writes find the node by running `narrowFn` once against a proxy that records the keys it reads, then write at that path, so a swap really replaces the node and untouched siblings keep their identity. Lookups like `s.todos.find((t) => t.id === id)` work; a `narrowFn` that returns a copy or computed value throws on write. You can narrow *to* a Map/Set but not *into* one (`m.get(k)`).
- A narrowed setter for a node that no longer exists is a no-op (so a stale handler can't throw).

## Scripts

`npm test`, `npm run typecheck`
