import {
  STORY_ELSE_HANDLE,
  STORY_OUTPUT_HANDLE,
  type StoryChapterGraph,
  type StoryChoiceNode,
  type StoryCondition,
  type StoryConditionNode,
  type StoryEffect,
  type StoryEndingNode,
  type StoryExitNode,
  type StoryNode,
  type StoryNodeKind,
  type StoryProgram,
  type StorySceneNode,
  type StoryValue,
  type StoryVariable,
  type StoryVariables,
} from './types'

export type StoryHaltReason = 'no_start' | 'missing_node' | 'dead_end' | 'unlinked_exit' | 'loop'
export type StoryStop =
  | { kind: 'scene'; projectId: string; node: StorySceneNode }
  | { kind: 'choice'; projectId: string; node: StoryChoiceNode }
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
export interface StoryRun {
  mode: StoryRunMode
  vars: StoryVariables
  stop: StoryStop
  trail: StoryTrailStep[]
}

const MAX_PASS_THROUGH_HOPS = 500
const MAX_TRAIL = 400

export function initialVariables(variables: StoryVariable[], preset: StoryVariables = {}): StoryVariables {
  return Object.fromEntries(variables.map((variable) => [variable.id, coerce(variable, preset[variable.id] ?? variable.initial)]))
}

function coerce(variable: StoryVariable, value: StoryValue): StoryValue {
  if (variable.type === 'boolean') return typeof value === 'boolean' ? value : value !== 0
  const number = typeof value === 'boolean' ? Number(value) : value
  return Number.isFinite(number) ? number : 0
}

export function applyEffects(vars: StoryVariables, effects: StoryEffect[], variables: StoryVariable[]): StoryVariables {
  if (!effects.length) return vars
  const byId = new Map(variables.map((variable) => [variable.id, variable]))
  const next = { ...vars }
  for (const effect of effects) {
    const variable = byId.get(effect.variableId)
    if (!variable) continue
    if (effect.op === 'set') next[variable.id] = coerce(variable, effect.value)
    else if (variable.type === 'number') next[variable.id] = coerce(variable, Number(next[variable.id] ?? 0) + Number(effect.value))
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

function nextNodeId(chapter: StoryChapterGraph, from: StoryNode, handle: string | null): string | null {
  const flows = chapter.flows.filter((flow) => flow.from === from.id)
  if (handle !== null) return flows.find((flow) => flow.handle === handle)?.to ?? null
  return (flows.find((flow) => flow.handle === STORY_OUTPUT_HANDLE) ?? flows[0])?.to ?? null
}

const halt = (reason: StoryHaltReason, message: string, projectId: string | null = null, nodeId: string | null = null): StoryStop =>
  ({ kind: 'halt', reason, message, projectId, nodeId })

function settle(program: StoryProgram, mode: StoryRunMode, projectId: string, nodeId: string, vars: StoryVariables, trail: StoryTrailStep[]): StoryRun {
  const chapters = new Map(program.chapters.map((chapter) => [chapter.projectId, chapter]))
  const done = (stop: StoryStop): StoryRun => ({ mode, vars, stop, trail: trail.slice(-MAX_TRAIL) })
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
}

export function startRun(program: StoryProgram, options: StartRunOptions): StoryRun {
  const vars = initialVariables(program.variables, options.preset)
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

/** Moves past the current stop. Choices need an option id; finished runs are returned unchanged. */
export function advanceRun(program: StoryProgram, run: StoryRun, optionId?: string): StoryRun {
  const { stop } = run
  if (stop.kind !== 'scene' && stop.kind !== 'choice') return run
  const chapter = program.chapters.find((item) => item.projectId === stop.projectId)
  if (!chapter) return { ...run, stop: halt('missing_node', '找不到当前章节。', stop.projectId) }
  let vars = run.vars
  let trail = run.trail
  let handle: string | null = null
  if (stop.kind === 'choice') {
    const option = stop.node.options.find((item) => item.id === optionId)
    if (!option) return run
    vars = applyEffects(vars, option.effects, program.variables)
    handle = option.id
    const last = trail[trail.length - 1]
    if (last?.nodeId === stop.node.id) trail = [...trail.slice(0, -1), { ...last, choice: option.label || option.id }]
  }
  const next = nextNodeId(chapter, stop.node, handle)
  if (!next) return { ...run, vars, trail, stop: halt('dead_end', `「${stop.node.title}」之后没有连接后续剧情。`, stop.projectId, stop.node.id) }
  return settle(program, run.mode, stop.projectId, next, vars, trail)
}

export function isRunFinished(run: StoryRun): boolean {
  return run.stop.kind === 'ending' || run.stop.kind === 'exit' || run.stop.kind === 'halt'
}

export function choiceTimeoutOption(node: StoryChoiceNode): string | null {
  return node.defaultOptionId ?? node.options[0]?.id ?? null
}
