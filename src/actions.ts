import { create, isDraft, type Draft } from 'mutative'
import { markRoot } from './patches.js'
import { getAt, mutateWith, pathOf, replacement, type SetStore } from './store.js'

/** Functions that take the state first, then mutate it or return a replacement for it. */
export type Actions<T> = Record<string, (state: Draft<T>, ...args: any[]) => T | void>

type AnyActions<A> = { [K in keyof A]: (state: any, ...args: any[]) => unknown }

// The state type of plain action functions: the type of their first parameter.
type FnState<A> = { [K in keyof A]: A[K] extends (state: infer S, ...args: any[]) => unknown ? S : never }[keyof A]

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never
// The `this` types the actions declare, or never for those that don't.
type DeclaredThis<A> = { [K in keyof A]: A[K] extends (this: infer X, ...args: any[]) => unknown ? (unknown extends X ? never : X) : never }[keyof A]
/** The context an action set needs from the levels above it: what its actions declare as their `this`. */
export type ContextOf<A> = [DeclaredThis<A>] extends [never] ? unknown : UnionToIntersection<DeclaredThis<A>>

const TREE = Symbol('react-narrow actions')
// Type-only keys: they carry types through, and never exist at runtime.
declare const TYPES: unique symbol
declare const ARG: unique symbol
declare const STATE: unique symbol

// What an action set is at runtime: its actions, and the levels narrowed from its state.
interface LevelDef {
  actions: Actions<any>
  // Built on first use, so a set can contain itself, for recursive data like an outline.
  children: () => Record<string, ChildDef>
  // The context of a set used as the root (see withContext).
  context?: unknown
}
// A narrowed level: a set, and how to get to its state from the parent's.
interface ChildDef extends LevelDef {
  narrow: LevelNarrower<any, unknown, object>
  // Whether `narrow` takes an argument, so the bound level is a function of it.
  hasArg: boolean
  provideContext?: ContextProvider<any, unknown, unknown, unknown>
}

/** What every action set is: its state `T`, its actions `A`, its narrowed levels `C`, and the context `X` it needs. */
export interface ActionTree<T, A, C, X = unknown> {
  readonly [TREE]: LevelDef
  // `context` is a parameter, so a set that needs a context isn't taken where none is given.
  readonly [TYPES]?: { state: T; actions: A; children: C; context: (context: X) => void }
}

/** A narrowed level inside an action set. `Arg` is the narrow function's argument, or `unknown` without one. */
export interface NarrowedActions<Arg, T, A, C> extends ActionTree<T, A, C, any> {
  readonly [ARG]?: Arg
}

/** A narrow function, or `{ get, swap }` when it can't be traced. Either can take an argument after the parent. */
export type LevelNarrower<P, Arg, T> =
  | ((parent: P, arg: Arg) => T | undefined)
  | { get: (parent: P, arg: Arg) => T | undefined; swap: (draft: Draft<P>, value: T, arg: Arg) => void }

type TreeContext<L> = L extends ActionTree<any, any, any, infer X> ? X : unknown

/**
 * Gives a narrowed level the context its set needs, when the action runs: from the parent's draft (so it can read
 * anything there, and write to it in the same update), the narrow function's argument, and the parent's own context.
 */
export type ContextProvider<P, Arg, PX, X> = (parent: Draft<P>, arg: Arg, context: PX) => X

/** Declares the levels narrowed from a state `P`, whose set has the context `PX`. */
export interface NarrowLevel<P, PX = unknown> {
  /**
   * A level that uses an action set. The narrow function is checked against the set's state. If the set needs a
   * context, `context` provides it; it can be left out when the parent's context already is one.
   */
  <Arg, L extends ActionTree<any, unknown, unknown, any>>(
    narrow: LevelNarrower<P, Arg, ActionState<L>>,
    actions: L,
    ...context: [PX] extends [TreeContext<L>]
      ? [context?: ContextProvider<P, Arg, PX, TreeContext<L>>]
      : [context: ContextProvider<P, Arg, PX, TreeContext<L>>]
  ): L extends ActionTree<infer T, infer A, infer C, any> ? NarrowedActions<Arg, T, A, C> : never
}

/** The state an action set works on. */
export type ActionState<L> = L extends ActionTree<infer T, any, any, any> ? T : never

// The set's own actions as functions of its state, which they take first and return the next value of.
type PureFns<T, A> = { [K in keyof A]: A[K] extends (state: any, ...args: infer P) => unknown ? (state: T, ...args: P) => T : never }

/**
 * An action set, made by `defineActions`. Bind it to a store by passing it to `useNewStore` or `createContextStore`,
 * or call its actions directly: each takes the state and returns the next state, so it's a pure function to test. A
 * set that needs a context is called directly, or used as a root, through `withContext`.
 */
export type ActionSet<T, A, C, X = unknown> = ActionTree<T, A, C, X> & (unknown extends X ? PureFns<T, A> : {})

type BoundFns<A> = { [K in keyof A]: A[K] extends (state: any, ...args: infer P) => unknown ? (...args: P) => void : never }

/** A level's actions without the state parameter, plus its narrowed levels. */
export type BoundLevel<T, A, C> = BoundFns<A> & {
  [K in keyof C]: C[K] extends NarrowedActions<infer Arg, infer N, infer NA, infer NC>
    ? unknown extends Arg
      ? BoundLevel<N, NA, NC>
      : (arg: Arg) => BoundLevel<N, NA, NC>
    : never
} & { readonly [STATE]?: T }

/** An action set (or plain action functions) bound to a store: no state parameter, and each writes to the store. */
export type BoundActions<A> = A extends ActionTree<infer T, infer LA, infer C, any> ? BoundLevel<T, LA, C> : BoundFns<A>

/** Any bound level whose state is `T`. */
export type BoundLevelOf<T> = { readonly [STATE]?: T }

/** The state of a bound level. */
export type BoundState<B> = B extends BoundLevelOf<infer T> ? T : never

/** An action set that needs no context, so it can be a store's root. */
export type RootActions = ActionTree<any, unknown, unknown, unknown>

const isObject = (v: unknown): v is object => v !== null && typeof v === 'object'

// The `narrow` that a set's `children` callback is given.
const narrowLevel = ((narrow: LevelNarrower<any, unknown, object>, set: ActionTree<unknown, unknown, unknown>, provideContext?: ChildDef['provideContext']) => {
  // A narrow function that declares a second parameter takes an argument (so give it no default value).
  const hasArg = (typeof narrow === 'function' ? narrow : narrow.get).length >= 2
  // A narrowed level gets its context from `provideContext`, never from withContext.
  const { context: _, ...def } = set[TREE]
  const child: ChildDef = { ...def, narrow, hasArg, provideContext }
  return { [TREE]: child }
}) as NarrowLevel<any>

function levelDef(actions: Actions<any>, children?: (narrow: NarrowLevel<any>) => Record<string, NarrowedActions<any, any, any, any>>): LevelDef {
  let childDefs: Record<string, ChildDef> | undefined
  return {
    actions,
    children: () => {
      if (childDefs) return childDefs
      childDefs = {}
      for (const [name, level] of Object.entries(children?.(narrowLevel) ?? {})) {
        if (Object.hasOwn(actions, name)) throw new Error(`react-narrow: "${name}" is both an action and a narrowed level`)
        childDefs[name] = level[TREE] as ChildDef
      }
      return childDefs
    },
  }
}

// One step down from a set's root towards the level where an action runs.
interface Step {
  child: ChildDef
  arg: unknown
}

const narrowTo = ({ child, arg }: Step, parent: unknown) => (typeof child.narrow === 'function' ? child.narrow(parent, arg) : child.narrow.get(parent, arg))

// Puts `value` where `step` narrows to in `parent`, a draft.
function replaceAt({ child, arg }: Step, parent: object, value: object) {
  const n = child.narrow
  if (typeof n !== 'function') return n.swap(parent as Draft<object>, value, arg)
  const path = pathOf(parent, (p) => n(p, arg))!
  getAt(parent, path.slice(0, -1))[path.at(-1)!] = value
}

/**
 * Runs `action` on `root`, a draft, at the end of `steps`: each level is found in its parent's draft, and gets its
 * context from it, so an action can also write to the levels above it in the same update. Returns a replacement for
 * the root, if the action replaced the root itself.
 */
function runAt(root: object, steps: Step[], context: unknown, action: Actions<any>[string], args: unknown[]): object | undefined {
  let node: unknown = root
  let parent: unknown
  for (const step of steps) {
    parent = node
    node = narrowTo(step, parent)
    // Deliberately silent, like a narrowed setter: late writes to deleted items are normal.
    if (node == null) return undefined
    if (step.child.provideContext) context = step.child.provideContext(parent, step.arg, context)
  }
  const result = (action as (this: unknown, ...a: unknown[]) => unknown).call(context, node, ...args)
  // Primitives are ignored like in setter recipes, so `s => s.count++` doesn't replace the state.
  if (!isObject(result) || result === node) return undefined
  if (!steps.length) return result
  replaceAt(steps.at(-1)!, parent as object, result)
  return undefined
}

// On each bound level below the root: the level it was narrowed from, and the step from there (see readLevel).
const LEVEL = Symbol('react-narrow level')
interface LevelInfo extends Step {
  parent: object
}
const infoOf = (level: object) => (level as { [LEVEL]?: LevelInfo })[LEVEL]

// The bound actions for `def`, at the end of `steps` from the store's root.
function bindLevel(set: SetStore<any>, def: LevelDef, steps: Step[] = []): Record<string, unknown> {
  const bound: Record<string, unknown> = {}
  for (const [key, action] of Object.entries(def.actions)) {
    bound[key] = (...args: unknown[]) =>
      mutateWith(set, (draft) => {
        const root = runAt(draft, steps, def.context, action, args)
        if (root) return replacement(root)
      })
  }
  for (const [name, child] of Object.entries(def.children())) {
    // A new level each call: where its identity matters (a memoized row), React memoizes it.
    const levelFor = (arg: unknown) => {
      const level = bindLevel(set, child, [...steps, { child, arg }])
      Object.defineProperty(level, LEVEL, { value: { parent: bound, child, arg } satisfies LevelInfo })
      return level
    }
    if (child.hasArg) bound[name] = levelFor
    else {
      // Without an argument, it's a property, bound on first read (so a recursive set doesn't bind forever).
      let level: Record<string, unknown> | undefined
      Object.defineProperty(bound, name, { get: () => (level ??= levelFor(undefined)), enumerable: true })
    }
  }
  return bound
}

// An action set: its definition, and its own actions as functions of its state. Each is pure on a plain value,
// and changes a draft in place, so that one action can call another.
function actionSetOf(def: LevelDef) {
  const actionSet: Record<string | symbol, unknown> = { [TREE]: def }
  for (const [key, action] of Object.entries(def.actions)) {
    actionSet[key] = (state: object, ...args: unknown[]) => {
      if (!isDraft(state)) return create(state, (draft) => runAt(draft, [], def.context, action, args) as never)
      return runAt(state, [], def.context, action, args) ?? state
    }
  }
  return actionSet
}

/**
 * Makes an action set from functions that take the state first, then mutate it or return a replacement. Write them
 * as methods. The state type comes from their first parameter. `children` declares the levels narrowed from it,
 * each using its own set:
 *
 *     const todoActionSet = defineActions({
 *       toggle(t: Todo) {
 *         t.done = !t.done
 *       },
 *     })
 *     const appActionSet = defineActions(appFns, (narrow) => ({
 *       todo: narrow((s, id: string) => s.todos.find((t) => t.id === id), todoActionSet),
 *     }))
 *
 * Bound to a store, that's `appActions.todo(id).toggle()`. Called directly, `todoActionSet.toggle(t)` returns the
 * toggled todo without changing `t`; on a draft, inside another action, it changes the draft in place.
 *
 * A set that needs something from the levels above it (a page's size, a way to record an undo step) declares it as
 * its actions' `this` type, and the level that narrows to it provides it.
 */
export function defineActions<A extends AnyActions<A>, C = {}>(
  // ThisType: in an action that doesn't declare its `this`, `this` is unknown (it's the context, not the set).
  actions: A & Actions<FnState<A>> & ThisType<unknown>,
  children?: (narrow: NarrowLevel<FnState<A>, ContextOf<A>>) => C,
): ActionSet<FnState<A>, A, C, ContextOf<A>>
/**
 * With the state type given, `defineActions<State>()(actions, children)`: each action's state parameter is typed
 * for you (as a `Draft<State>`), and the set can have no actions of its own.
 */
export function defineActions<T>(): <A extends AnyActions<A> = {}, C = {}>(
  actions: A & Actions<T> & ThisType<unknown>,
  children?: (narrow: NarrowLevel<T, ContextOf<A>>) => C,
) => ActionSet<T, A, C, ContextOf<A>>
export function defineActions(actions?: Actions<any>, children?: any): unknown {
  if (!actions) return (actions: Actions<any>, children?: any) => actionSetOf(levelDef(actions, children))
  return actionSetOf(levelDef(actions, children))
}

/** A set that needs a context, given one, so it can be called directly (in tests) or be a store's root. */
export function withContext<T, A, C, X>(set: ActionTree<T, A, C, X>, context: X): ActionSet<T, A, C> {
  return actionSetOf({ ...set[TREE], context }) as unknown as ActionSet<T, A, C>
}

/** Binds an action set to a setter, which can be any store's. */
export function bindActions<T extends object, L extends ActionTree<T, unknown, unknown, unknown>>(set: SetStore<T>, actions: L): BoundActions<L> {
  // Marked as the root, so applyPatches can write through it.
  return markRoot(bindLevel(set, actions[TREE]), set) as BoundActions<L>
}

export const isActionSet = (a: unknown): a is ActionTree<unknown, unknown, unknown> => typeof a === 'object' && a !== null && TREE in a

/** Reads the value of `level` from the value of `top`, a bound level above it. */
export function readLevel(top: object, topValue: unknown, level: object): unknown {
  // The steps from `top` down to `level`, found by walking up from `level`.
  const steps: Step[] = []
  for (let l = level; l !== top; ) {
    const info = infoOf(l)
    if (!info) throw new Error('react-narrow: the picked actions are not a level below the given actions')
    steps.unshift(info)
    l = info.parent
  }
  return steps.reduce<unknown>((v, step) => (v == null ? v : narrowTo(step, v)), topValue)
}

