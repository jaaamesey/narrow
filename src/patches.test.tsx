import { act, fireEvent, render, screen } from '@testing-library/react'
import { apply, type Patches } from 'mutative'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  applyPatches,
  createContextStore,
  createTestStore,
  defineActions,
  useNewStore,
  type OnPatches,
} from './index'
import { narrowSetter } from './store'

type Todo = { id: number; title: string; done: boolean }
type State = { todos: Todo[]; byId: Map<string, { n: number }>; ui: { tab: string } }
const initial = (): State => ({
  todos: [
    { id: 1, title: 'a', done: false },
    { id: 2, title: 'b', done: false },
  ],
  byId: new Map([['x', { n: 1 }]]),
  ui: { tab: 'all' },
})

const todoActionSet = defineActions({
  toggle(t: Todo) {
    t.done = !t.done
  },
  reset(t: Todo) {
    return { ...t, title: '', done: false }
  },
})
const appActionSet = defineActions(
  {
    clearDone(s: State) {
      return { ...s, todos: s.todos.filter((t) => !t.done) }
    },
  },
  (narrow) => ({ todo: narrow((s, id: number) => s.todos.find((t) => t.id === id), todoActionSet) }),
)

// Every call to onPatches, as [patches, inversePatches, applied].
const recorder = () => {
  const calls: [Patches, Patches, boolean][] = []
  const onPatches: OnPatches = (p, ip, { applied }) => void calls.push([p, ip, applied])
  return { calls, onPatches }
}

describe('patches from a setter', () => {
  it('gives the patches for a write through narrowed setters, with paths from the root', () => {
    const { calls, onPatches } = recorder()
    const store = createTestStore(initial(), { onPatches })
    const todos = narrowSetter(store.set, (s: State) => s.todos)
    const todo = narrowSetter(todos, (ts) => ts.find((t) => t.id === 2))
    todo((t) => {
      t.done = true
    })
    expect(calls).toEqual([[[{ op: 'replace', path: ['todos', 1, 'done'], value: true }], [{ op: 'replace', path: ['todos', 1, 'done'], value: false }], false]])
  })

  it('gives a replace at the root for a swap, and nothing for a write that changes nothing', () => {
    const { calls, onPatches } = recorder()
    const store = createTestStore(initial(), { onPatches })
    const before = store.state
    store.set((s) => s, 'swap')
    store.set((s) => void s.ui.tab)
    expect(calls).toEqual([])
    const next = { ...before, ui: { tab: 'done' } }
    store.set(next)
    expect(calls).toEqual([[[{ op: 'replace', path: [], value: next }], [{ op: 'replace', path: [], value: before }], false]])
  })

  it('gives a replace of the entry for a Map narrowed with { get, swap }', () => {
    const { calls, onPatches } = recorder()
    const store = createTestStore(initial(), { onPatches })
    const x = narrowSetter(store.set, { get: (s: State) => s.byId.get('x'), swap: (d, v) => void d.byId.set('x', v) })
    x((e) => {
      e.n = 2
    })
    expect(calls[0]![0]).toEqual([{ op: 'replace', path: ['byId', 'x'], value: { n: 2 } }])
  })
})

describe('patches from actions', () => {
  it('gives the patches for an action on a narrowed level, and for one that replaces its level or the root', () => {
    const { calls, onPatches } = recorder()
    const store = createTestStore(initial(), appActionSet, { onPatches })
    store.actions.todo(1).toggle()
    expect(calls[0]![0]).toEqual([{ op: 'replace', path: ['todos', 0, 'done'], value: true }])
    store.actions.todo(2).reset()
    expect(calls[1]![0]).toEqual([{ op: 'replace', path: ['todos', 1], value: { id: 2, title: '', done: false } }])
    store.actions.clearDone()
    expect(calls[2]![0]).toEqual([{ op: 'replace', path: [], value: store.state }])
  })
})

describe('applyPatches', () => {
  it('undoes a change with its inverse patches, reported as applied', () => {
    const { calls, onPatches } = recorder()
    const store = createTestStore(initial(), appActionSet, { onPatches })
    const before = store.state
    store.actions.todo(1).toggle()
    applyPatches(store.actions, calls[0]![1])
    expect(store.state).toEqual(before)
    // The other todo, and everything else, is shared.
    expect(store.state.todos[1]).toBe(before.todos[1])
    expect(calls[1]).toEqual([calls[0]![1], calls[0]![0], true])
  })

  it('works with a root setter, and refuses a narrowed one', () => {
    const store = createTestStore(initial())
    applyPatches(store.set, [{ op: 'replace', path: ['ui', 'tab'], value: 'done' }])
    expect(store.state.ui.tab).toBe('done')
    const ui = narrowSetter(store.set, (s: State) => s.ui)
    expect(() => applyPatches(ui, [])).toThrow(/root setter or actions/)
  })

  it('makes patches that are plain data, which any copy of Mutative can apply', () => {
    const { calls, onPatches } = recorder()
    const store = createTestStore({ todos: initial().todos }, { onPatches })
    store.set((s) => {
      s.todos.push({ id: 3, title: 'c', done: false })
      s.todos[0]!.title = 'A'
    })
    const sent = JSON.parse(JSON.stringify(calls[0]![0])) as Patches
    expect(apply({ todos: initial().todos }, sent)).toEqual(store.state)
  })
})

describe('onPatches in React', () => {
  function App({ onPatches }: { onPatches: OnPatches }) {
    const [state, appActions] = useNewStore(initial(), appActionSet, { onPatches })
    return (
      <>
        <button onClick={() => appActions.todo(1).toggle()}>one</button>
        <button
          onClick={() => {
            appActions.todo(1).toggle()
            appActions.todo(2).toggle()
          }}
        >
          two
        </button>
        <button onClick={() => applyPatches(appActions, [{ op: 'replace', path: ['ui', 'tab'], value: 'x' }])}>apply</button>
        <span>{state.todos.map((t) => (t.done ? 'y' : 'n')).join('')}</span>
      </>
    )
  }

  it('reports each update once after its commit, even in Strict Mode', () => {
    const onPatches = vi.fn<OnPatches>()
    render(
      <StrictMode>
        <App onPatches={onPatches} />
      </StrictMode>,
    )
    fireEvent.click(screen.getByText('one'))
    expect(screen.getByText('yn')).toBeTruthy()
    expect(onPatches).toHaveBeenCalledOnce()
    expect(onPatches.mock.calls[0]![0]).toEqual([{ op: 'replace', path: ['todos', 0, 'done'], value: true }])
  })

  it('reports batched updates one by one, in order', () => {
    const onPatches = vi.fn<OnPatches>()
    render(<App onPatches={onPatches} />)
    fireEvent.click(screen.getByText('two'))
    expect(screen.getByText('yy')).toBeTruthy()
    expect(onPatches.mock.calls.map((c) => c[0][0]!.path)).toEqual([
      ['todos', 0, 'done'],
      ['todos', 1, 'done'],
    ])
  })

  it('marks updates from applyPatches as applied, and uses the latest onPatches', () => {
    const first = vi.fn<OnPatches>()
    const second = vi.fn<OnPatches>()
    const { rerender } = render(<App onPatches={first} />)
    rerender(<App onPatches={second} />)
    fireEvent.click(screen.getByText('apply'))
    expect(first).not.toHaveBeenCalled()
    expect(second.mock.calls[0]![2]).toEqual({ applied: true })
  })

  it('takes onPatches on a context Provider that owns its store', () => {
    const appStore = createContextStore<{ count: number }>()
    function Counter() {
      const set = appStore.useSet()
      return <button onClick={() => set((s) => void s.count++)}>{appStore.useVal().count}</button>
    }
    const { calls, onPatches } = recorder()
    render(
      <appStore.Provider initial={{ count: 0 }} onPatches={onPatches}>
        <Counter />
      </appStore.Provider>,
    )
    act(() => fireEvent.click(screen.getByText('0')))
    expect(calls).toEqual([[[{ op: 'replace', path: ['count'], value: 1 }], [{ op: 'replace', path: ['count'], value: 0 }], false]])
  })
})
