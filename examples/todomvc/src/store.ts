import { useSyncExternalStore } from 'react'
import { createContextStore } from 'react-narrow'

export type Todo = { id: string; title: string; completed: boolean }
export type State = { todos: Todo[] }

export const todosDef = createContextStore<State>()

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

export const useFilter = () => useSyncExternalStore(subscribeToHash, readFilter)
