import {
  STORY_ELSE_HANDLE,
  STORY_OUTPUT_HANDLE,
  STORY_TIMEOUT_HANDLE,
  type StoryChapterGraph,
  type StoryChoiceNode,
  type StoryChoiceOption,
  type StoryCondition,
  type StoryConditionNode,
  type StoryEffect,
  type StoryEndingNode,
  type StoryExitNode,
  type StoryInteractionNode,
  type StoryInteractionSpec,
  type StoryNode,
  type StoryNodeKind,
  type StoryOptionUnlock,
  type StoryProgram,
  type StorySceneNode,
  type StoryShopItem,
  type StoryValue,
  type StoryVariable,
  type StoryVariables,
} from './types'
import { beatResult, interactionHandleLabel, interactionHandles, interactionTimeoutHandle, STORY_RETRY_REWIND_SEC } from './interaction'
import { tallyPersonality, type StoryPersonalityCounts } from './personality'

export type StoryHaltReason = 'no_start' | 'missing_node' | 'dead_end' | 'unlinked_exit' | 'loop'
export type StoryStop =
  | { kind: 'scene'; projectId: string; node: StorySceneNode }
  | { kind: 'choice'; projectId: string; node: StoryChoiceNode }
  | { kind: 'interaction'; projectId: string; node: StoryInteractionNode }
  | { kind: 'ending'; projectId: string; node: StoryEndingNode }
  | { kind: 'exit'; projectId: string; node: StoryExitNode }
  | { kind: 'halt'; projectId: string | null; nodeId: string | null; reason: StoryHaltReason; message: string }

export interface StoryTrailStep {
  projectId: string
  nodeId: string
  kind: StoryNodeKind
  title: string
  choice?: string
}

export type StoryRunMode = 'story' | 'chapter'
/** A cut the viewer already earned that waits for the current segment to finish. */
export interface StoryPending {
  nodeId: string
  label: string
}
export interface StoryRun {
  mode: StoryRunMode
  vars: StoryVariables
  stop: StoryStop
  trail: StoryTrailStep[]
  pending?: StoryPending | null
  /** How many of each shop item this play has bought. */
  purchases?: Record<string, number>
  /** Personality-test letters the viewer's picks have scored this play. */
  personality?: StoryPersonalityCounts
}

type RunCarry = Pick<StoryRun, 'purchases' | 'personality'>

/** The parts of a run that survive moving to the next stop (a pending cut does not). */
const carryOf = (run: StoryRun): RunCarry => ({
  ...(run.purchases ? { purchases: run.purchases } : {}),
  ...(run.personality ? { personality: run.personality } : {}),
})

const MAX_PASS_THROUGH_HOPS = 500
const MAX_TRAIL = 400

export function initialVariables(variables: StoryVariable[], preset: StoryVariables = {}): StoryVariables {
  return Object.fromEntries(variables.map((variable) => [variable.id, settleValue(variable, preset[variable.id] ?? variable.initial)]))
}

function coerce(variable: StoryVariable, value: StoryValue): StoryValue {
  if (variable.type === 'boolean') return typeof value === 'boolean' ? value : value !== 0
  const number = typeof value === 'boolean' ? Number(value) : value
  return Number.isFinite(number) ? number : 0
}

/** The upper bound of a capped number value, or null. */
export const variableMax = (variable: StoryVariable): number | null =>
  variable.type === 'number' && typeof variable.max === 'number' && Number.isFinite(variable.max) ? variable.max : null

/** Type-correct and, for a capped number, no higher than its upper bound. */
export function settleValue(variable: StoryVariable, value: StoryValue): StoryValue {
  const next = coerce(variable, value)
  const max = variableMax(variable)
  return max !== null && typeof next === 'number' ? Math.min(max, next) : next
}

export const isPermanentVariable = (variable: StoryVariable) => variable.scope === 'permanent'

/** What to keep between plays: only the permanent values. */
export function permanentValues(variables: StoryVariable[], vars: StoryVariables): StoryVariables {
  return Object.fromEntries(variables.filter(isPermanentVariable).map((variable) => [variable.id, vars[variable.id] ?? variable.initial]))
}

/** Of the values a viewer brought from earlier plays, only the permanent ones are carried into a new run. */
export function carriedPermanent(variables: StoryVariable[], saved: StoryVariables = {}): StoryVariables {
  return Object.fromEntries(variables.filter((variable) => isPermanentVariable(variable) && variable.id in saved).map((variable) => [variable.id, saved[variable.id]]))
}

export function applyEffects(vars: StoryVariables, effects: StoryEffect[], variables: StoryVariable[]): StoryVariables {
  if (!effects.length) return vars
  const byId = new Map(variables.map((variable) => [variable.id, variable]))
  const next = { ...vars }
  for (const effect of effects) {
    const variable = byId.get(effect.variableId)
    if (!variable) continue
    if (effect.op === 'set') next[variable.id] = settleValue(variable, effect.value)
    else if (variable.type === 'number') next[variable.id] = settleValue(variable, Number(next[variable.id] ?? 0) + Number(effect.value))
  }
  return next
}

export function evaluateCondition(condition: StoryCondition, vars: StoryVariables, variables: StoryVariable[]): boolean {
  const variable = variables.find((item) => item.id === condition.variableId)
  if (!variable) return false
  const left = Number(vars[variable.id] ?? variable.initial)
  const right = Number(coerce(variable, condition.value))
  switch (condition.op) {
    case '==': return left === right
    case '!=': return left !== right
    case '>': return left > right
    case '>=': return left >= right
    case '<': return left < right
    case '<=': return left <= right
  }
}

/** First matching branch wins; returns the handle to follow. */
export function pickConditionHandle(node: StoryConditionNode, vars: StoryVariables, variables: StoryVariable[]): string {
  for (const branch of node.branches) {
    if (!branch.conditions.length) continue
    const test = (condition: StoryCondition) => evaluateCondition(condition, vars, variables)
    const matched = branch.match === 'any' ? branch.conditions.some(test) : branch.conditions.every(test)
    if (matched) return branch.id
  }
  return STORY_ELSE_HANDLE
}

export type StoryOptionState = 'open' | 'locked' | 'hidden'

export function unlockMet(unlock: StoryOptionUnlock, vars: StoryVariables, variables: StoryVariable[]): boolean {
  if (!unlock.conditions.length) return true
  const test = (condition: StoryCondition) => evaluateCondition(condition, vars, variables)
  return unlock.match === 'any' ? unlock.conditions.some(test) : unlock.conditions.every(test)
}

export function optionState(option: Pick<StoryChoiceOption, 'unlock'>, vars: StoryVariables, variables: StoryVariable[]): StoryOptionState {
  const { unlock } = option
  if (!unlock || unlockMet(unlock, vars, variables)) return 'open'
  return unlock.mode === 'locked' ? 'locked' : 'hidden'
}

export interface StoryOptionView<T> {
  option: T
  locked: boolean
  /** The shop item a locked card links to. */
  shopItemId: string | null
}

/**
 * The cards a viewer sees: hidden options are left out, locked ones stay but cannot be picked.
 * When every option is closed the first one opens, so a choice can never trap the viewer.
 */
export function visibleOptions<T extends Pick<StoryChoiceOption, 'unlock'>>(options: readonly T[], vars: StoryVariables, variables: StoryVariable[]): StoryOptionView<T>[] {
  const states = options.map((option) => optionState(option, vars, variables))
  const anyOpen = states.includes('open')
  return options.flatMap((option, index) => {
    const state = !anyOpen && index === 0 ? 'open' : states[index]
    if (state === 'hidden') return []
    return [{ option, locked: state === 'locked', shopItemId: state === 'locked' ? option.unlock?.shopItemId ?? null : null }]
  })
}

/** Whether the viewer may pick this option right now. */
export function isOptionOpen<T extends Pick<StoryChoiceOption, 'id' | 'unlock'>>(options: readonly T[], optionId: string, vars: StoryVariables, variables: StoryVariable[]): boolean {
  return visibleOptions(options, vars, variables).some((view) => view.option.id === optionId && !view.locked)
}

/** The preferred option when it can be picked, otherwise the first one that can. */
function openOptionOr(options: readonly StoryChoiceOption[], preferred: string | null, vars: StoryVariables, variables: StoryVariable[]): string | null {
  const open = visibleOptions(options, vars, variables).filter((view) => !view.locked).map((view) => view.option.id)
  return preferred && open.includes(preferred) ? preferred : open[0] ?? preferred
}

function nextNodeId(chapter: StoryChapterGraph, from: StoryNode, handle: string | null): string | null {
  const flows = chapter.flows.filter((flow) => flow.from === from.id)
  if (handle !== null) return flows.find((flow) => flow.handle === handle)?.to ?? null
  return (flows.find((flow) => flow.handle === STORY_OUTPUT_HANDLE) ?? flows[0])?.to ?? null
}

const halt = (reason: StoryHaltReason, message: string, projectId: string | null = null, nodeId: string | null = null): StoryStop =>
  ({ kind: 'halt', reason, message, projectId, nodeId })

function settle(
  program: StoryProgram,
  mode: StoryRunMode,
  projectId: string,
  nodeId: string,
  vars: StoryVariables,
  trail: StoryTrailStep[],
  carry: RunCarry = {},
): StoryRun {
  const chapters = new Map(program.chapters.map((chapter) => [chapter.projectId, chapter]))
  const done = (stop: StoryStop): StoryRun => ({ mode, vars, stop, trail: trail.slice(-MAX_TRAIL), ...carry })
  for (let hops = 0; hops < MAX_PASS_THROUGH_HOPS; hops += 1) {
    const chapter = chapters.get(projectId)
    const node = chapter?.nodes.find((item) => item.id === nodeId)
    if (!chapter || !node) return done(halt('missing_node', '找不到下一个剧情节点，请检查连线。', projectId, nodeId))
    const step: StoryTrailStep = { projectId, nodeId, kind: node.kind, title: node.title }
    trail = [...trail, step]
    if (node.kind === 'scene') {
      vars = applyEffects(vars, node.effects, program.variables)
      return done({ kind: 'scene', projectId, node })
    }
    if (node.kind === 'choice') return done({ kind: 'choice', projectId, node })
    if (node.kind === 'interaction') return done({ kind: 'interaction', projectId, node })
    if (node.kind === 'ending') return done({ kind: 'ending', projectId, node })
    if (node.kind === 'exit') {
      if (mode === 'chapter') return done({ kind: 'exit', projectId, node })
      const link = program.links.find((item) => item.fromProjectId === projectId && item.exitNodeId === node.id)
      if (!link) return done(halt('unlinked_exit', `出口「${node.title}」还没有连接到下一章。`, projectId, node.id))
      projectId = link.toProjectId
      nodeId = link.toEntryNodeId
      continue
    }
    let handle: string | null = null
    if (node.kind === 'condition') {
      handle = pickConditionHandle(node, vars, program.variables)
      step.choice = handle === STORY_ELSE_HANDLE ? '否则' : node.branches.find((branch) => branch.id === handle)?.label || handle
    }
    const next = nextNodeId(chapter, node, handle)
    if (!next) return done(halt('dead_end', `「${node.title}」之后没有连接后续剧情。`, projectId, node.id))
    nodeId = next
  }
  return done(halt('loop', '剧情在条件之间无限循环，请检查条件连线。', projectId, nodeId))
}

export interface StartRunOptions {
  mode: StoryRunMode
  projectId?: string
  entryNodeId?: string
  preset?: StoryVariables
  /** Values kept from earlier plays; only the permanent variables take them. */
  permanent?: StoryVariables
}

export function startRun(program: StoryProgram, options: StartRunOptions): StoryRun {
  const vars = initialVariables(program.variables, { ...options.preset, ...carriedPermanent(program.variables, options.permanent) })
  if (options.mode === 'story') {
    const start = options.projectId && options.entryNodeId
      ? { projectId: options.projectId, entryNodeId: options.entryNodeId }
      : program.start
    if (!start) return { mode: 'story', vars, trail: [], stop: halt('no_start', '还没有设置故事起点。') }
    return settle(program, 'story', start.projectId, start.entryNodeId, vars, [])
  }
  const chapter = program.chapters.find((item) => item.projectId === options.projectId)
  const entry = chapter?.nodes.find((node) => node.kind === 'entry' && (!options.entryNodeId || node.id === options.entryNodeId))
  if (!chapter || !entry) return { mode: 'chapter', vars, trail: [], stop: halt('no_start', '本章还没有入口节点。', options.projectId ?? null) }
  return settle(program, 'chapter', chapter.projectId, entry.id, vars, [])
}

const withTrailChoice = (trail: StoryTrailStep[], step: StoryTrailStep): StoryTrailStep[] => [...trail, step].slice(-MAX_TRAIL)

/**
 * Moves past the current stop. Choices need an option id, interactions a result handle;
 * a scene that carries a pending cut follows it instead of its own exit. Finished runs are returned unchanged.
 */
export function advanceRun(program: StoryProgram, run: StoryRun, optionId?: string): StoryRun {
  const { stop } = run
  if (stop.kind !== 'scene' && stop.kind !== 'choice' && stop.kind !== 'interaction') return run
  const chapter = program.chapters.find((item) => item.projectId === stop.projectId)
  if (!chapter) return { ...run, stop: halt('missing_node', '找不到当前章节。', stop.projectId) }
  let vars = run.vars
  let trail = run.trail
  let personality = run.personality
  let handle: string | null = null
  if (stop.kind === 'scene' && run.pending) {
    return settle(program, run.mode, stop.projectId, run.pending.nodeId, vars, trail, carryOf(run))
  }
  if (stop.kind === 'choice') {
    if (stop.node.timeoutMode === 'exit' && optionId === STORY_TIMEOUT_HANDLE) {
      handle = STORY_TIMEOUT_HANDLE
      const last = trail[trail.length - 1]
      if (last?.nodeId === stop.node.id) trail = [...trail.slice(0, -1), { ...last, choice: '超时' }]
    } else {
      const option = stop.node.options.find((item) => item.id === optionId)
      if (!option || !isOptionOpen(stop.node.options, option.id, vars, program.variables)) return run
      vars = applyEffects(vars, option.effects, program.variables)
      personality = tallyPersonality(personality, option.tags)
      handle = option.id
      const last = trail[trail.length - 1]
      if (last?.nodeId === stop.node.id) trail = [...trail.slice(0, -1), { ...last, choice: option.label || option.id }]
    }
  }
  if (stop.kind === 'interaction') {
    if (!optionId || !interactionHandles(stop.node.spec).includes(optionId)) return run
    if (!handleIsOpen(stop.node.spec, optionId, vars, program.variables)) return run
    const result = beatResult(stop.node, optionId)
    vars = applyEffects(vars, result.effects, program.variables)
    const last = trail[trail.length - 1]
    if (last?.nodeId === stop.node.id) trail = [...trail.slice(0, -1), { ...last, choice: interactionHandleLabel(stop.node.spec, optionId) }]
    if (result.retry) return { ...run, vars, trail }
    if (stop.node.spec.type === 'choice') personality = tallyPersonality(personality, stop.node.spec.options.find((item) => item.id === optionId)?.tags)
    handle = optionId
  }
  const carry = carryOf({ ...run, personality })
  const next = nextNodeId(chapter, stop.node, handle)
  if (!next) return { ...run, vars, trail, ...carry, stop: halt('dead_end', `「${stop.node.title}」之后没有连接后续剧情。`, stop.projectId, stop.node.id) }
  return settle(program, run.mode, stop.projectId, next, vars, trail, carry)
}

/** Result ports other than a choice's options are always open; an option is open unless its unlock still holds it. */
function handleIsOpen(spec: StoryInteractionSpec, handle: string, vars: StoryVariables, variables: StoryVariable[]): boolean {
  if (spec.type !== 'choice' || handle === STORY_TIMEOUT_HANDLE) return true
  return isOptionOpen(spec.options, handle, vars, variables)
}

export type BeatOutcome =
  | { kind: 'continue'; run: StoryRun }
  | { kind: 'retry'; run: StoryRun; seekSec: number }
  | { kind: 'cut'; run: StoryRun }
  | { kind: 'defer'; run: StoryRun }

/**
 * Settles one result of an interaction mounted on the current scene. Value effects always apply;
 * the picture then keeps playing (nothing linked), rewinds, cuts at once, or waits for the segment to end.
 */
export function resolveBeat(program: StoryProgram, run: StoryRun, beatId: string, handle: string): BeatOutcome {
  const { stop } = run
  if (stop.kind !== 'scene') return { kind: 'continue', run }
  const beat = stop.node.beats.find((item) => item.id === beatId)
  if (!beat || !interactionHandles(beat.spec).includes(handle) || !handleIsOpen(beat.spec, handle, run.vars, program.variables)) return { kind: 'continue', run }
  const result = beatResult(beat, handle)
  const vars = applyEffects(run.vars, result.effects, program.variables)
  const trail = withTrailChoice(run.trail, { projectId: stop.projectId, nodeId: beat.id, kind: 'interaction', title: beat.title, choice: interactionHandleLabel(beat.spec, handle) })
  if (result.retry) return { kind: 'retry', run: { ...run, vars, trail }, seekSec: Math.max(0, beat.startSec - STORY_RETRY_REWIND_SEC) }
  const picked = beat.spec.type === 'choice' ? beat.spec.options.find((option) => option.id === handle) : undefined
  const personality = tallyPersonality(run.personality, picked?.tags)
  const scored = personality ? { personality } : {}
  const chapter = program.chapters.find((item) => item.projectId === stop.projectId)
  const next = chapter ? nextNodeId(chapter, beat, handle) : null
  if (!chapter || !next) return { kind: 'continue', run: { ...run, vars, trail, ...scored } }
  if (result.when === 'after') {
    const label = chapter.nodes.find((node) => node.id === next)?.title ?? ''
    return { kind: 'defer', run: { ...run, vars, trail, ...scored, pending: { nodeId: next, label } } }
  }
  return { kind: 'cut', run: settle(program, run.mode, stop.projectId, next, vars, trail, carryOf({ ...run, ...scored })) }
}

export function isRunFinished(run: StoryRun): boolean {
  return run.stop.kind === 'ending' || run.stop.kind === 'exit' || run.stop.kind === 'halt'
}

/**
 * The option a timed choice lands on when the countdown ends, or the timeout handle when it has its own exit.
 * Given the viewer's values, a default that is still locked gives way to the first option they can pick.
 */
export function choiceTimeoutOption(node: StoryChoiceNode, vars?: StoryVariables, variables?: StoryVariable[]): string | null {
  if (node.timeoutMode === 'exit') return STORY_TIMEOUT_HANDLE
  const preferred = node.defaultOptionId ?? node.options[0]?.id ?? null
  return vars && variables ? openOptionOr(node.options, preferred, vars, variables) : preferred
}

/** The handle a mounted or standalone interaction lands on when its time limit runs out, never a locked option. */
export function beatTimeoutHandle(spec: StoryInteractionSpec, vars: StoryVariables, variables: StoryVariable[]): string | null {
  const handle = interactionTimeoutHandle(spec)
  if (spec.type !== 'choice' || handle === STORY_TIMEOUT_HANDLE) return handle
  return openOptionOr(spec.options, handle, vars, variables)
}

export interface StoryShopItemView {
  item: StoryShopItem
  owned: number
  soldOut: boolean
  affordable: boolean
}

const openShop = (program: StoryProgram) => (program.shop?.enabled ? program.shop : null)

function currencyVariable(program: StoryProgram): StoryVariable | null {
  const currencyId = program.shop?.currencyVariableId
  const variable = currencyId ? program.variables.find((item) => item.id === currencyId) : undefined
  return variable?.type === 'number' ? variable : null
}

/**
 * What the shop screen shows for this play. Empty when the creator has not switched the shop on.
 * A title or frame the viewer already keeps from an earlier play (`ownedRewards`, shop item ids) cannot be bought twice.
 */
export function shopItemViews(program: StoryProgram, run: StoryRun, ownedRewards: readonly string[] = []): StoryShopItemView[] {
  const shop = openShop(program)
  if (!shop) return []
  const currency = currencyVariable(program)
  return shop.items.map((item) => {
    const kept = item.reward && ownedRewards.includes(item.id)
    const owned = Math.max(run.purchases?.[item.id] ?? 0, kept ? 1 : 0)
    return {
      item,
      owned,
      soldOut: kept || (item.limit > 0 && owned >= item.limit),
      affordable: !currency || Number(run.vars[currency.id] ?? 0) >= item.price,
    }
  })
}

export type PurchaseFailure = 'no_shop' | 'unknown_item' | 'sold_out' | 'cannot_afford'
export type PurchaseResult = { ok: true; run: StoryRun } | { ok: false; reason: PurchaseFailure; run: StoryRun }

/**
 * Buys one shop item: pays in the shop's currency value when it has one (otherwise the price is only
 * a label and the purchase is a free simulation), then gives the item's values. The viewer stays where they are.
 */
export function purchaseShopItem(program: StoryProgram, run: StoryRun, itemId: string, ownedRewards: readonly string[] = []): PurchaseResult {
  if (!openShop(program)) return { ok: false, reason: 'no_shop', run }
  const view = shopItemViews(program, run, ownedRewards).find((entry) => entry.item.id === itemId)
  if (!view) return { ok: false, reason: 'unknown_item', run }
  if (view.soldOut) return { ok: false, reason: 'sold_out', run }
  if (!view.affordable) return { ok: false, reason: 'cannot_afford', run }
  const currency = currencyVariable(program)
  const pay: StoryEffect[] = currency && view.item.price > 0 ? [{ variableId: currency.id, op: 'add', value: -view.item.price }] : []
  const vars = applyEffects(run.vars, [...pay, ...view.item.effects], program.variables)
  return { ok: true, run: { ...run, vars, purchases: { ...run.purchases, [itemId]: view.owned + 1 } } }
}
