import { useState } from 'react'
import type { BoundActions } from 'react-narrow'
import type { Todo } from './store'
import type { todoActionSet } from './todoActionSet'

// Sees only its own todo and actions bound to it, and re-renders only when that todo changes.
export function TodoItem({
  todo,
  todoActions,
  onDestroy,
}: {
  todo: Todo
  todoActions: BoundActions<typeof todoActionSet>
  onDestroy: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)

  const finishEditing = (input: HTMLInputElement) => {
    const title = input.value.trim()
    setEditing(false)
    if (title) todoActions.rename(title)
    else onDestroy(todo.id)
  }

  return (
    <li className={[todo.completed && 'completed', editing && 'editing'].filter(Boolean).join(' ')}>
      <div className="view">
        <input
          className="toggle"
          type="checkbox"
          checked={todo.completed}
          onChange={todoActions.toggle}
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
