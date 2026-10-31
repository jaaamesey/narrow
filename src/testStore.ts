import { type ActionState, type ActionTree, bindActions, type BoundActions, isActionSet, type RootActions } from './actions.js'
import { type Change, rootSetter, type StoreOptions } from './patches.js'
import type { SetStore } from './store.js'

/**
 * A store outside React, for tests: `state` is always the latest value, and writes apply at once. Like
 * `useNewStore`, it has a setter (`set`), or with an action set, `actions` bound to it instead. Components don't
 * re-render when it changes, so it isn't a way to share state.
 */
export function createTestStore<T extends object>(initial: T | (() => T), options?: StoreOptions): { readonly state: T; set: SetStore<T> }
export function createTestStore<L extends RootActions>(
  initial: NoInfer<ActionState<L>> | (() => NoInfer<ActionState<L>>),
  actions: L,
  options?: StoreOptions,
): { readonly state: ActionState<L>; actions: BoundActions<L> }
export function createTestStore(
  initial: any,
  actionsOrOptions?: RootActions | StoreOptions,
  options?: StoreOptions,
): { readonly state: any; set?: SetStore<any>; actions?: unknown } {
  const actions = isActionSet(actionsOrOptions) ? (actionsOrOptions as RootActions) : undefined
  const { onPatches } = (actions ? options : (actionsOrOptions as StoreOptions | undefined)) ?? {}
  let state = typeof initial === 'function' ? initial() : initial
  let change: Change | undefined
  const set = rootSetter(
    (fn) => {
      state = fn(state)
      // Reported once the state is updated, like the React stores do after their commit.
      if (change) onPatches!(change.patches, change.inversePatches, { applied: change.applied })
      change = undefined
    },
    () => onPatches && ((c) => (change = c)),
  )
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
