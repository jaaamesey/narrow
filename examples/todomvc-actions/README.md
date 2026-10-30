# react-narrow • TodoMVC with actions

[`examples/todomvc`](../todomvc), with every update written as an action instead of an inline setter call.

```sh
npm install                               # from the repo root
npm run dev -w examples/todomvc-actions
```

- `src/todoActionSet.ts` is the action set for a single todo: `toggle` and `rename`.
- `src/appActionSet.ts` is the set for the whole app: `add`, `destroy`, `setAllCompleted` and `clearCompleted` (which returns a new state instead of mutating it), plus a `todo` level that gives each todo `todoActionSet`, picked by its id. That's every way the state can change, in one place.

Called directly, each action is a pure function, so they're tested without React: `todoActionSet.toggle(todo)` returns the toggled todo.

`src/store.ts` makes a context for the app's action store. In `src/App.tsx`, components call `todosDef.useActions()` (as `appActions`), and never get a setter. `Header` only writes, so it never re-renders when the todos change. `NarrowList` takes `actions={appActions.todo}` and gives each `TodoItem` its todo's actions, so a row can only change its own todo, and only re-renders when that todo changes.
