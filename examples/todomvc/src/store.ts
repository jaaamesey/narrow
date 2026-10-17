import { useSyncExternalStore } from 'react'
import { createContextStore, createNarrowedStoreContext } from 'narrow'

export type Todo = { id: string; title: string; completed: boolean }
export type State = { todos: Todo[] }

/** The whole app's state. */
export const todosDef = createContextStore<State>()

/**
 * One todo, narrowed out of the app state by id.
 *
 * Encapsulation: components under `<todoDef.Provider>` only ever see a `Todo`
 * and a setter for that one todo. They don't know the app's state shape and
 * can't touch any other todo.
 *
 * Performance: thanks to structural sharing, editing one todo leaves every other
 * todo object untouched, so the narrowed context's value only changes for the
 * todo that was edited. Only that todo's components re-render.
 */
export const todoDef = createNarrowedStoreContext(todosDef, (s, id: string) => s.todos.find((t) => t.id === id)!)

const STORAGE_KEY = 'todos-narrow'

export function loadState(): State {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)!) ?? { todos: [] }
  } catch {
    return { todos: [] }
  }
}

export const saveState = (state: State) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

export type Filter = 'all' | 'active' | 'completed'

const readFilter = (): Filter => {
  const hash = location.hash.replace('#/', '')
  return hash === 'active' || hash === 'completed' ? hash : 'all'
}
const subscribeToHash = (onChange: () => void) => {
  addEventListener('hashchange', onChange)
  return () => removeEventListener('hashchange', onChange)
}

/** The current filter, from the URL (`#/`, `#/active`, `#/completed`), as TodoMVC specifies. */
export const useFilter = () => useSyncExternalStore(subscribeToHash, readFilter)
