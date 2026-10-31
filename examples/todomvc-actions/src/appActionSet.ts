import { defineActions } from 'react-narrow'
import type { State } from './store'
import { todoActionSet } from './todoActionSet'

// Actions on the whole app state, and a `todo` level with each todo's actions.
export const appActionSet = defineActions(
  {
    add(s: State, id: string, title: string) {
      s.todos.push({ id, title, completed: false })
    },
    destroy(s: State, id: string) {
      const i = s.todos.findIndex((t) => t.id === id)
      if (i !== -1) s.todos.splice(i, 1)
    },
    setAllCompleted(s: State, completed: boolean) {
      for (const t of s.todos) t.completed = completed
    },
    // Returning a value replaces the state instead of mutating it.
    clearCompleted(s: State) {
      return { ...s, todos: s.todos.filter((t) => !t.completed) }
    },
  },
  (narrow) => ({
    todo: narrow((s, id: string) => s.todos.find((t) => t.id === id), todoActionSet),
  }),
)
