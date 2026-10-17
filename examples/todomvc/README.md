# narrow • TodoMVC

The standard [TodoMVC](https://todomvc.com) app, built with `narrow`, with the [React Compiler](https://react.dev/learn/react-compiler) enabled.

```sh
npm install          # from the repo root (this is an npm workspace)
npm run dev -w examples/todomvc
```

Where to look:

- **`src/store.ts`**: the app state (`todosDef`), and `todoDef`, which narrows it to one todo by id.
- **`src/TodoItem.tsx`**: a todo row. It only sees its own `Todo` and a setter for it, so it knows nothing about the app's state shape and can't touch other todos.
- **`src/App.tsx`**: `Main` wraps each row in `<todoDef.Provider narrowArg={id}>`.

What this buys you:

- **Encapsulation:** a row is written against `Todo`, not against the whole app state.
- **Performance:** editing, toggling or deleting a todo re-renders only that row. Other rows keep the same todo objects (structural sharing), so their narrowed context doesn't change. `Header` only sets state, so it never re-renders after mount.
