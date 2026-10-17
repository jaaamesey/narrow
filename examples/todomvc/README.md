# narrow • TodoMVC

The standard [TodoMVC](https://todomvc.com) app, built with `narrow`, with the [React Compiler](https://react.dev/learn/react-compiler) enabled.

```sh
npm install          # from the repo root (this is an npm workspace)
npm run dev -w examples/todomvc
```

Where to look:

- **`src/store.ts`**: the app state (`todosDef`).
- **`src/TodoItem.tsx`**: a todo row. It only sees its own `Todo` and a setter for it, so it knows nothing about the app's state shape and can't touch other todos.
- **`src/App.tsx`**: `Main` narrows the state to the todos array, then `<NarrowList>` narrows that to one store per todo.

What this buys you:

- **Encapsulation:** a row is written against `Todo`, not against the whole app state.
- **Performance:** editing, toggling or deleting a todo re-renders only that row, with no `memo` or dependency arrays. Other rows keep the same todo objects (structural sharing) and stable setters, so `NarrowList` skips them. `Header` only sets state, so it never re-renders after mount.
