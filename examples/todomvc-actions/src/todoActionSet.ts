import { defineActions } from 'react-narrow'
import type { Todo } from './store'

// Actions on a single todo. `appActionSet` gives each todo these, picked by its id.
export const todoActionSet = defineActions({
  toggle(todo: Todo) {
    todo.completed = !todo.completed
  },
  rename(todo: Todo, title: string) {
    todo.title = title
  },
})
