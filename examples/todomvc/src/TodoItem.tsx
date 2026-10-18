import { useState } from 'react'
import type { SetStore } from 'react-narrow'
import type { Todo } from './store'

// Sees only its own todo and a setter for it, and re-renders only when that todo changes.
export function TodoItem({ todo, setTodo, onDestroy }: { todo: Todo; setTodo: SetStore<Todo>; onDestroy: (id: string) => void }) {
  const [editing, setEditing] = useState(false)

  const finishEditing = (input: HTMLInputElement) => {
    const title = input.value.trim()
    setEditing(false)
    if (title) {
      setTodo((t) => {
        t.title = title
      })
    } else {
      onDestroy(todo.id)
    }
  }

  return (
    <li className={[todo.completed && 'completed', editing && 'editing'].filter(Boolean).join(' ')}>
      <div className="view">
        <input
          className="toggle"
          type="checkbox"
          checked={todo.completed}
          onChange={() =>
            setTodo((t) => {
              t.completed = !t.completed
            })
          }
        />
        <label onDoubleClick={() => setEditing(true)}>{todo.title}</label>
        <button className="destroy" onClick={() => onDestroy(todo.id)} />
      </div>
      {editing && (
        <input
          className="edit"
          defaultValue={todo.title}
          autoFocus
          onBlur={(e) => finishEditing(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.value = todo.title // cancel
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
          }}
        />
      )}
    </li>
  )
}
