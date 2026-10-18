# react-narrow • TodoMVC

[TodoMVC](https://todomvc.com) built with `react-narrow` and the [React Compiler](https://react.dev/learn/react-compiler).

```sh
npm install                       # from the repo root
npm run dev -w examples/todomvc
```

The app state lives in `src/store.ts`. In `src/App.tsx`, `Main` narrows it to the list of todos, and `NarrowList` gives each `TodoItem` its own todo and a setter for it.

`TodoItem` only knows about a single `Todo`, so it doesn't depend on how the rest of the state is shaped. Toggling, editing or deleting a todo only re-renders that row, without any `memo`.
