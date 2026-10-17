import { useCallback, useEffect } from 'react'
import { TodoItem } from './TodoItem'
import { loadState, saveState, todoDef, todosDef, useFilter, type Filter } from './store'

/**
 * The provider owns the store, so `App` itself never re-renders: only the
 * components below that read the state do.
 */
export function App() {
  return (
    <todosDef.Provider initial={loadState}>
      <Persist />
      <section className="todoapp">
        <Header />
        <Main />
        <Footer />
      </section>
      <footer className="info">
        <p>Double-click to edit a todo</p>
        <p>
          Part of <a href="https://todomvc.com">TodoMVC</a>
        </p>
      </footer>
    </todosDef.Provider>
  )
}

function Persist() {
  const state = todosDef.useVal()
  useEffect(() => saveState(state), [state])
  return null
}

/** Only sets state, so it never re-renders when todos change. */
function Header() {
  const setTodos = todosDef.useSet()
  return (
    <header className="header">
      <h1>todos</h1>
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        autoFocus
        onKeyDown={(e) => {
          const title = e.currentTarget.value.trim()
          if (e.key !== 'Enter' || !title) return
          setTodos((s) => {
            s.todos.push({ id: crypto.randomUUID(), title, completed: false })
          })
          e.currentTarget.value = ''
        }}
      />
    </header>
  )
}

function Main() {
  const { todos } = todosDef.useVal()
  const setTodos = todosDef.useSet()
  const filter = useFilter()
  // Stable for the life of the app, so it doesn't defeat TodoItem's `memo`.
  const destroy = useCallback(
    (id: string) =>
      setTodos((s) => {
        s.todos = s.todos.filter((t) => t.id !== id)
      }),
    [setTodos],
  )
  if (!todos.length) return null

  const allCompleted = todos.every((t) => t.completed)
  const visible = todos.filter((t) => filter === 'all' || t.completed === (filter === 'completed'))
  return (
    <section className="main">
      <input
        id="toggle-all"
        className="toggle-all"
        type="checkbox"
        checked={allCompleted}
        onChange={() =>
          setTodos((s) => {
            for (const t of s.todos) t.completed = !allCompleted
          })
        }
      />
      <label htmlFor="toggle-all">Mark all as complete</label>
      <ul className="todo-list">
        {visible.map((t) => (
          // Narrow the app state to this one todo for everything inside.
          <todoDef.Provider key={t.id} narrowArg={t.id}>
            <TodoItem onDestroy={destroy} />
          </todoDef.Provider>
        ))}
      </ul>
    </section>
  )
}

const FILTERS: [Filter, string, string][] = [
  ['all', 'All', '#/'],
  ['active', 'Active', '#/active'],
  ['completed', 'Completed', '#/completed'],
]

function Footer() {
  const { todos } = todosDef.useVal()
  const setTodos = todosDef.useSet()
  const filter = useFilter()
  if (!todos.length) return null

  const active = todos.filter((t) => !t.completed).length
  return (
    <footer className="footer">
      <span className="todo-count">
        <strong>{active}</strong> {active === 1 ? 'item' : 'items'} left
      </span>
      <ul className="filters">
        {FILTERS.map(([value, label, href]) => (
          <li key={value}>
            <a href={href} className={filter === value ? 'selected' : undefined}>
              {label}
            </a>
          </li>
        ))}
      </ul>
      {active < todos.length && (
        <button
          className="clear-completed"
          onClick={() =>
            setTodos((s) => {
              s.todos = s.todos.filter((t) => !t.completed)
            })
          }
        >
          Clear completed
        </button>
      )}
    </footer>
  )
}
