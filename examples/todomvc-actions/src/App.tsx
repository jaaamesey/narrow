import { useEffect } from 'react'
import { NarrowList } from 'react-narrow'
import { TodoItem } from './TodoItem'
import { loadState, saveState, todosDef, useFilter, type Filter } from './store'

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

// Only writes, so it never re-renders when the todos change.
function Header() {
  const appActions = todosDef.useActions()
  return (
    <header className="header">
      <h1>todos</h1>
      <form
        action={(data) => {
          const title = String(data.get('title')).trim()
          // The id is made here, not in the action: actions run as state updaters, so they must be pure.
          if (title) appActions.add(crypto.randomUUID(), title)
        }}
      >
        <input name="title" className="new-todo" placeholder="What needs to be done?" autoFocus />
      </form>
    </header>
  )
}

function Main() {
  const { todos } = todosDef.useVal()
  const appActions = todosDef.useActions()
  const filter = useFilter()
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
        onChange={() => appActions.setAllCompleted(!allCompleted)}
      />
      <label htmlFor="toggle-all">Mark all as complete</label>
      <ul className="todo-list">
        {/* Each row gets `appActions.todo(id)`: actions that can only change that todo. */}
        <NarrowList items={visible} getKey={(t) => t.id} actions={appActions.todo}>
          {(todo, todoActions) => <TodoItem todo={todo} todoActions={todoActions} onDestroy={appActions.destroy} />}
        </NarrowList>
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
  const appActions = todosDef.useActions()
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
        <button className="clear-completed" onClick={() => appActions.clearCompleted()}>
          Clear completed
        </button>
      )}
    </footer>
  )
}
