import { useEffect } from 'react'
import { NarrowList, useNarrowedStore } from 'narrow'
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

function Header() {
  const setTodos = todosDef.useSet()
  return (
    <header className="header">
      <h1>todos</h1>
      <form
        action={(data) => {
          const title = String(data.get('title')).trim()
          if (!title) return
          setTodos((s) => {
            s.todos.push({ id: crypto.randomUUID(), title, completed: false })
          })
        }}
      >
        <input name="title" className="new-todo" placeholder="What needs to be done?" autoFocus />
      </form>
    </header>
  )
}

function Main() {
  const state = todosDef.useVal()
  const setState = todosDef.useSet()
  const [todos, setTodos] = useNarrowedStore(state, (s) => s.todos, setState)
  const filter = useFilter()
  if (!todos.length) return null

  const destroy = (id: string) =>
    setTodos((ts) => {
      ts.splice(ts.findIndex((t) => t.id === id), 1)
    })
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
          setTodos((ts) => {
            for (const t of ts) t.completed = !allCompleted
          })
        }
      />
      <label htmlFor="toggle-all">Mark all as complete</label>
      <ul className="todo-list">
        {/* `visible` is filtered; each todo's setter still writes to the full array. */}
        <NarrowList items={visible} setStore={setTodos} getKey={(t) => t.id}>
          {(todo, setTodo) => <TodoItem todo={todo} setTodo={setTodo} onDestroy={destroy} />}
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
