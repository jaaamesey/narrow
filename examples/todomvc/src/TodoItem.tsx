import { memo, useState } from 'react'
import { todoDef } from './store'

/**
 * A single todo. It reads and writes its own todo through `todoDef` and knows
 * nothing about the rest of the app: no ids to look up, no list to search.
 *
 * `memo` keeps it from re-rendering just because the list re-rendered, so it
 * only re-renders when its own todo changes (or `onDestroy` does, which is stable).
 * It's needed even with the React Compiler, which creates new elements for each
 * call of a `.map` callback.
 */
export const TodoItem = memo(function TodoItem({ onDestroy }: { onDestroy: (id: string) => void }) {
  const todo = todoDef.useVal()
  const setTodo = todoDef.useSet()
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
})
