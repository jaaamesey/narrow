import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { current, original, useNewStore, type SetStore } from './index'

type S = { selected: number }

describe('original and current', () => {
  it('read the draft from inside a recipe', () => {
    let seen: { before: unknown; now: unknown } | undefined
    let set!: SetStore<S>
    let state!: S
    function App() {
      ;[state, set] = useNewStore<S>({ selected: 0 })
      return null
    }
    render(<App />)
    const before = state
    act(() =>
      set((s) => {
        s.selected = 1
        seen = { before: original(s), now: current(s) }
      }),
    )
    expect(seen!.before).toBe(before)
    expect(seen!.now).toEqual({ ...before, selected: 1 })
  })
})
