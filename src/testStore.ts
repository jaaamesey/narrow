import { type ActionState, type ActionTree, bindActions, type BoundActions, type RootActions } from './actions.js'
import { applyUpdate, type SetStore } from './store.js'

/**
 * A store outside React, for tests: `state` is always the latest value, and writes apply at once. Like
 * `useNewStore`, it has a setter (`set`), or with an action set, `actions` bound to it instead. Components don't
 * re-render when it changes, so it isn't a way to share state.
 */
export function createTestStore<T extends object>(initial: T | (() => T)): { readonly state: T; set: SetStore<T> }
export function createTestStore<L extends RootActions>(
  initial: NoInfer<ActionState<L>> | (() => NoInfer<ActionState<L>>),
  actions: L,
): { readonly state: ActionState<L>; actions: BoundActions<L> }
export function createTestStore(initial: any, actions?: RootActions): { readonly state: any; set?: SetStore<any>; actions?: unknown } {
  let state = typeof initial === 'function' ? initial() : initial
  const set = ((next: unknown, mode?: 'mutate' | 'swap') => void (state = applyUpdate(state, next, mode))) as SetStore<object>
  if (actions) {
    const bound = bindActions(set, actions as ActionTree<object, unknown, unknown>)
    return {
      get state() {
        return state
      },
      actions: bound,
    }
  }
  return {
    get state() {
      return state
    },
    set,
  }
}
