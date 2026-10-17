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

Returning a state from a mutate recipe is a **type error**, not a runtime one. Expression-bodied assignments (`s => s.a = 1`) are fine.

## Context

```tsx
const storeDef = createContextStore<State>(/* optional default */)

<storeDef.Provider initial={...}>   {/* or store={valueFromUseNewStore} */}
const store = storeDef.use()        // value; re-renders on change
const setStore = storeDef.useSet()  // stable, never re-renders
```

## Narrowing

```tsx
const [todo, setTodo] = useNarrowedStore(store, (s) => s.todos[i]!)

<Narrow store={store} by={(s) => s.todos[i]!}>
  {(todo, setTodo) => <TodoRow todo={todo} onToggle={() => setTodo((t) => { t.done = !t.done })} />}
</Narrow>

const todoDef = createNarrowedStoreContext(storeDef, (s, i: number) => s.todos[i]!)
<todoDef.Provider arg={i}><TodoRow /></todoDef.Provider>   // todoDef.use() / useSet() inside
```

`useSelector(store, (s) => s.x)` subscribes to a slice only.

- Narrow functions must return an object/array/Map/Set (enforced by types) located *inside* the parent state. Inline functions are fine.
- Values passed to `useNarrowedStore` / `<Narrow>` / `useSelector` must come from this library (`useNewStore`, `use()`, a narrowed hook). Each state version is tracked in a `WeakMap` so the value can be traced back to its store; anything else throws.
- Swapping a narrowed store replaces its contents in place (same kind only), so untouched siblings keep their identity.
- If the target vanishes (e.g. a list item is removed before its child unmounts) reads keep returning the last value and writes are no-ops.

## Scripts

`npm test`, `npm run typecheck`
