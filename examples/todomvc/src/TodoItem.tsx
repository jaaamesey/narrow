import { useState } from 'react'
import type { SetStore } from 'narrow'
import type { Todo } from './store'

/**
 * A single todo, narrowed out of the app state by `<NarrowList>`.
 *
 * Encapsulation: it only ever sees one `Todo` and a setter for that todo. It
 * doesn't know the app's state shape and can't touch any other todo.
 *
 * Performance: editing this todo re-renders only this component. Other todos
 * keep their identity (structural sharing) and stable setters, so `NarrowList`
 * skips them. No `memo` needed.
 */
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
            if (e.key === 'Escape') e.currentTarget.value = todo.title // cancel: blur then saves the unchanged title
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
          }}
        />
      )}
    </li>
  )
}
