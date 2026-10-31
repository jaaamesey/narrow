// How to test code that uses react-narrow. Each test is a pattern the README's Testing section points to.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createContextStore,
  createTestStore,
  defineActions,
  type BoundActions,
  type SetStore,
} from './index'

type Todo = { id: number; title: string; done: boolean }
type State = { todos: Todo[] }

// As they'd be written in their own modules.
const todoActionSet = defineActions({
  toggle(t: Todo) {
    t.done = !t.done
  },
  rename(t: Todo, title: string) {
    t.title = title
  },
})
const appActionSet = defineActions(
  {
    add(s: State, id: number, title: string) {
      s.todos.push({ id, title, done: false })
    },
    clearDone(s: State) {
      return { todos: s.todos.filter((t) => !t.done) }
    },
  },
  (narrow) => ({ todo: narrow((s, id: number) => s.todos.find((t) => t.id === id), todoActionSet) }),
)
const appStore = createContextStore(appActionSet)

function TodoRow({ todo, todoActions }: { todo: Todo; todoActions: BoundActions<typeof todoActionSet> }) {
  return (
    <label>
      <input type="checkbox" checked={todo.done} onChange={() => todoActions.toggle()} />
      {todo.title}
    </label>
  )
}

function TodoList() {
  const { todos } = appStore.useVal()
  const appActions = appStore.useActions()
  return (
    <>
      {todos.map((t) => (
        <TodoRow key={t.id} todo={t} todoActions={appActions.todo(t.id)} />
      ))}
      <button onClick={() => appActions.clearDone()}>Clear done</button>
    </>
  )
}

describe('testing actions', () => {
  // Called directly, each action takes the state and returns the next one, whether it mutates or replaces.
  it('tests an action as a pure function', () => {
    const t = { id: 1, title: 'a', done: false }
    expect(todoActionSet.toggle(t).done).toBe(true)
    expect(t.done).toBe(false)
  })
  it('tests a replacing action the same way', () => {
    const state: State = { todos: [{ id: 1, title: 'a', done: true }] }
    expect(appActionSet.clearDone(state).todos).toEqual([])
  })
  it('chains several actions with createTestStore', () => {
    const store = createTestStore({ todos: [] }, appActionSet)
    store.actions.add(1, 'a')
    store.actions.todo(1).rename('b')
    store.actions.todo(1).toggle()
    expect(store.state.todos).toEqual([{ id: 1, title: 'b', done: true }])
  })
})

describe('testing components', () => {
  it('passes real actions from createTestStore, then checks the state', () => {
    const store = createTestStore({ todos: [{ id: 1, title: 'a', done: false }] }, appActionSet)
    const { rerender } = render(<TodoRow todo={store.state.todos[0]!} todoActions={store.actions.todo(1)} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(store.state.todos[0]!.done).toBe(true)
    // Props don't follow the store by themselves: render again to see the new state.
    rerender(<TodoRow todo={store.state.todos[0]!} todoActions={store.actions.todo(1)} />)
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
  })
  it('passes spies, to check which action was called', () => {
    const todoActions = { toggle: vi.fn(), rename: vi.fn() }
    render(<TodoRow todo={{ id: 1, title: 'a', done: false }} todoActions={todoActions} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(todoActions.toggle).toHaveBeenCalledOnce()
  })
  it('renders a component that uses a context inside its Provider', () => {
    render(
      <appStore.Provider initial={{ todos: [{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }] }}>
        <TodoList />
      </appStore.Provider>,
    )
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    fireEvent.click(screen.getByText('Clear done'))
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByText('b')).toBeTruthy()
  })
  it('passes a setter from createTestStore to a component that takes one', () => {
    function Title({ todo, setTodo }: { todo: Todo; setTodo: SetStore<Todo> }) {
      return <button onClick={() => setTodo((t) => void (t.title = t.title.toUpperCase()))}>{todo.title}</button>
    }
    const store = createTestStore<Todo>({ id: 1, title: 'a', done: false })
    render(<Title todo={store.state} setTodo={store.set} />)
    fireEvent.click(screen.getByRole('button'))
    expect(store.state.title).toBe('A')
  })
})
