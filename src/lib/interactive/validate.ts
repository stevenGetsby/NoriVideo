import { findStoryLinkCycle } from './config'
import { beatResult, beatWindowsOverlap, interactionHandleLabel, interactionHandles, STORY_MOUNTED_CHOICE_MAX_OPTIONS } from './interaction'
import {
  STORY_ELSE_HANDLE,
  STORY_PERSONALITY_AXES,
  STORY_TIMEOUT_HANDLE,
  type StoryChapterGraph,
  type StoryChoiceOption,
  type StoryEffect,
  type StoryInteractionNode,
  type StoryIssue,
  type StoryIssueLevel,
  type StoryNode,
  type StoryProgram,
  type StoryReward,
  type StorySceneNode,
  type StorySequence,
  type StoryShop,
  type StoryVariable,
} from './types'

function issue(level: StoryIssueLevel, code: string, message: string, projectId: string | null, nodeId: string | null = null): StoryIssue {
  return { level, code, message, projectId, nodeId }
}

function effectIssues(owner: Pick<StoryNode, 'id' | 'title'>, effects: StoryEffect[], variables: StoryVariable[], projectId: string): StoryIssue[] {
  return effects.flatMap((effect) => {
    const variable = variables.find((item) => item.id === effect.variableId)
    if (!variable) return [issue('error', 'unknown_variable', `「${owner.title}」修改了不存在的变量。`, projectId, owner.id)]
    if (effect.op === 'add' && variable.type === 'boolean') {
      return [issue('error', 'effect_add_boolean', `「${owner.title}」不能对开关变量「${variable.name}」做加减。`, projectId, owner.id)]
    }
    return []
  })
}

/** Unlock conditions and shop links of the options one choice (standalone or mounted) offers. */
function optionUnlockIssues(
  owner: Pick<StoryNode, 'id' | 'title'>,
  label: string,
  options: StoryChoiceOption[],
  variables: StoryVariable[],
  shop: StoryShop | undefined,
  projectId: string,
): StoryIssue[] {
  const issues: StoryIssue[] = []
  const known = new Set(variables.map((variable) => variable.id))
  for (const option of options) {
    const { unlock } = option
    if (!unlock) continue
    const name = option.label.trim() || '未命名选项'
    if (unlock.conditions.some((condition) => !known.has(condition.variableId))) {
      issues.push(issue('error', 'unknown_variable', `${label}「${owner.title}」的选项「${name}」的解锁条件引用了不存在的变量。`, projectId, owner.id))
    }
    if (unlock.mode !== 'locked' || !unlock.shopItemId) continue
    const item = shop?.enabled ? shop.items.find((entry) => entry.id === unlock.shopItemId) : undefined
    if (!item) {
      issues.push(issue('warning', 'unlock_shop_missing', `${label}「${owner.title}」的选项「${name}」想去商城买来解锁，但那件商品已不存在或商城没有开启。`, projectId, owner.id))
    } else if (!item.effects.some((effect) => unlock.conditions.some((condition) => condition.variableId === effect.variableId))) {
      issues.push(issue('warning', 'unlock_shop_no_effect', `${label}「${owner.title}」的选项「${name}」关联的商品「${item.name.trim() || '未命名商品'}」不会改变解锁条件里的任何数值，买了也打不开。`, projectId, owner.id))
    }
  }
  if (options.length && options.every((option) => option.unlock)) {
    issues.push(issue('error', 'choice_all_locked', `${label}「${owner.title}」的每个选项都设置了解锁条件，条件都不满足时玩家会无路可选。请至少留一个始终可选的选项。`, projectId, owner.id))
  }
  return issues
}

const BEAT_RANGE_EPSILON = 0.05

function seconds(value: number) {
  return `${Math.round(value * 10) / 10}`
}

function interactionIssues(node: StoryInteractionNode, handles: Set<string>, variables: StoryVariable[], shop: StoryShop | undefined, projectId: string): StoryIssue[] {
  const issues: StoryIssue[] = []
  const standalone = node.mountedOn === null
  const { spec } = node
  const known = new Set(interactionHandles(spec))
  for (const handle of known) {
    const result = beatResult(node, handle)
    const label = interactionHandleLabel(spec, handle)
    issues.push(...effectIssues(node, result.effects, variables, projectId))
    if (standalone && !result.retry && !handles.has(handle)) {
      const optionHandle = spec.type === 'choice' && handle !== STORY_TIMEOUT_HANDLE
      issues.push(issue('error', optionHandle ? 'option_unlinked' : 'result_unlinked', `互动「${node.title}」的「${label}」还没有连接后续剧情。`, projectId, node.id))
    }
    if (!standalone && result.retry && handles.has(handle)) {
      issues.push(issue('warning', 'result_retry_linked', `互动「${node.title}」的「${label}」选了失败重来，连线不会生效。`, projectId, node.id))
    }
  }
  if ([...handles].some((handle) => !known.has(handle))) {
    issues.push(issue('warning', 'stale_flow', `互动「${node.title}」有连线指向已删除的结果。`, projectId, node.id))
  }
  if (spec.type === 'choice') {
    if (!spec.options.length) issues.push(issue('error', 'choice_empty', `互动「${node.title}」没有选项。`, projectId, node.id))
    else if (spec.options.length === 1) issues.push(issue('warning', 'choice_single', `互动「${node.title}」只有一个选项。`, projectId, node.id))
    if (spec.options.length > STORY_MOUNTED_CHOICE_MAX_OPTIONS) {
      issues.push(issue('warning', 'choice_too_many', `互动「${node.title}」超过 ${STORY_MOUNTED_CHOICE_MAX_OPTIONS} 个选项，画面会很拥挤。`, projectId, node.id))
    }
    if (spec.panelStyle !== 'text' && spec.options.some((option) => !option.imageUrl)) {
      issues.push(issue('error', 'choice_image_missing', `互动「${node.title}」选了图片版式，但有选项没有图片。`, projectId, node.id))
    }
    if (spec.panelStyle !== 'image' && spec.options.some((option) => !option.label.trim())) {
      issues.push(issue('warning', 'option_label', `互动「${node.title}」有选项没有文案。`, projectId, node.id))
    }
    issues.push(...optionUnlockIssues(node, '互动', spec.options, variables, shop, projectId))
  }
  return issues
}

function beatIssues(scene: StorySceneNode, projectId: string): StoryIssue[] {
  const issues: StoryIssue[] = []
  const { beats, media } = scene
  if (!beats.length) return issues
  if (media?.kind !== 'video') {
    issues.push(issue('warning', 'beat_needs_video', `片段「${scene.title}」没有视频，挂在上面的互动不会触发。`, projectId, scene.id))
  }
  for (const beat of beats) {
    const end = beat.startSec + beat.durationSec
    if (media?.kind === 'video' && media.durationSec && end > media.durationSec + BEAT_RANGE_EPSILON) {
      issues.push(issue('error', 'beat_out_of_range', `互动「${beat.title}」的时间段（${seconds(beat.startSec)}–${seconds(end)} 秒）超出了视频时长 ${seconds(media.durationSec)} 秒。`, projectId, beat.id))
    }
  }
  const sorted = [...beats].sort((a, b) => a.startSec - b.startSec)
  for (let index = 1; index < sorted.length; index += 1) {
    if (beatWindowsOverlap(sorted[index - 1], sorted[index])) {
      issues.push(issue('error', 'beat_overlap', `互动「${sorted[index - 1].title}」与「${sorted[index].title}」的时间段重叠。`, projectId, sorted[index].id))
    }
  }
  return issues
}

function conditionLoopNode(chapter: StoryChapterGraph): string | null {
  const conditionIds = new Set(chapter.nodes.filter((node) => node.kind === 'condition').map((node) => node.id))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): string | null => {
    if (state.get(id) === 'visiting') return id
    if (state.get(id) === 'done') return null
    state.set(id, 'visiting')
    for (const flow of chapter.flows) {
      if (flow.from !== id || !conditionIds.has(flow.to)) continue
      const found = visit(flow.to)
      if (found) return found
    }
    state.set(id, 'done')
    return null
  }
  for (const id of conditionIds) {
    const found = visit(id)
    if (found) return found
  }
  return null
}

/** A scene without its own exit is fine when every interaction result either branches or retries. */
function sceneEndsInBeatCuts(scene: StorySceneNode, flows: StoryChapterGraph['flows']): boolean {
  if (!scene.beats.length) return false
  return scene.beats.every((beat) => interactionHandles(beat.spec).every((handle) =>
    beatResult(beat, handle).retry || flows.some((flow) => flow.from === beat.id && flow.handle === handle)))
}

function variableIssues(variables: StoryVariable[]): StoryIssue[] {
  return variables.flatMap((variable) => {
    if (variable.type !== 'number' || typeof variable.max !== 'number' || typeof variable.initial !== 'number') return []
    if (variable.initial <= variable.max) return []
    return [issue('warning', 'variable_over_max', `数值「${variable.name}」的初始值 ${variable.initial} 超过了上限 ${variable.max}，开局会被压到上限。`, null)]
  })
}

const hasReward = (reward: StoryReward | undefined) => Boolean(reward && (reward.title || reward.frameUrl))

function shopIssues(shop: StoryShop | undefined, variables: StoryVariable[]): StoryIssue[] {
  if (!shop?.enabled) return []
  const issues: StoryIssue[] = []
  const currency = shop.currencyVariableId ? variables.find((variable) => variable.id === shop.currencyVariableId) : null
  if (shop.currencyVariableId && currency?.type !== 'number') {
    issues.push(issue('error', 'shop_currency_invalid', '商城指定用来付款的数值已被删除或不是数字，请重新选择。', null))
  }
  if (!shop.items.length) issues.push(issue('warning', 'shop_empty', '商城已开启，但还没有商品。', null))
  if (!shop.currencyVariableId && shop.items.some((item) => item.price > 0)) {
    issues.push(issue('warning', 'shop_no_currency', '商城还没有指定用哪个数值付款，购买只是模拟、不会扣除数值。', null))
  }
  for (const item of shop.items) {
    const name = item.name.trim() || '未命名商品'
    if (!item.name.trim()) issues.push(issue('warning', 'shop_item_name', '有商品没有名字。', null))
    if (!item.effects.length && !hasReward(item.reward)) {
      issues.push(issue('warning', 'shop_item_no_effect', `商品「${name}」买下后没有任何数值变化，也没有称号或头像框。`, null))
    }
    for (const effect of item.effects) {
      const variable = variables.find((entry) => entry.id === effect.variableId)
      if (!variable) issues.push(issue('error', 'unknown_variable', `商品「${name}」修改了不存在的变量。`, null))
      else if (effect.op === 'add' && variable.type === 'boolean') {
        issues.push(issue('error', 'effect_add_boolean', `商品「${name}」不能对开关变量「${variable.name}」做加减。`, null))
      }
    }
  }
  return issues
}

/** Every option of every choice in the story, standalone or mounted on a segment, each choice counted once. */
function choiceOptionsOf(program: StoryProgram): StoryChoiceOption[] {
  const seen = new Set<string>()
  const options: StoryChoiceOption[] = []
  const take = (projectId: string, id: string, list: StoryChoiceOption[]) => {
    const key = `${projectId}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    options.push(...list)
  }
  for (const chapter of program.chapters) {
    for (const node of chapter.nodes) {
      if (node.kind === 'choice') take(chapter.projectId, node.id, node.options)
      else if (node.kind === 'interaction' && node.spec.type === 'choice') take(chapter.projectId, node.id, node.spec.options)
      else if (node.kind === 'scene') {
        for (const beat of node.beats) if (beat.spec.type === 'choice') take(chapter.projectId, beat.id, beat.spec.options)
      }
    }
  }
  return options
}

function personalityIssues(program: StoryProgram): StoryIssue[] {
  const marked = program.chapters.flatMap((chapter) =>
    chapter.nodes.flatMap((node) => (node.kind === 'ending' && node.showPersonality ? [{ projectId: chapter.projectId, node }] : [])))
  if (!program.personality?.enabled) {
    return marked.map(({ projectId, node }) =>
      issue('warning', 'ending_personality_off', `结局「${node.title}」勾选了显示人格结果，但玩法设置里没有开启人格测试。`, projectId, node.id))
  }
  const issues: StoryIssue[] = []
  const scored = new Set(choiceOptionsOf(program).flatMap((option) => option.tags ?? []))
  if (!scored.size) {
    issues.push(issue('warning', 'personality_no_tags', '人格测试已开启，但还没有任何选项带 E/I/S/N/T/F/J/P 字母，玩家得不到结果。', null))
  } else {
    for (const [left, right] of STORY_PERSONALITY_AXES) {
      if (!scored.has(left) && !scored.has(right)) {
        issues.push(issue('warning', 'personality_axis_missing', `人格测试里没有选项给「${left}/${right}」这一对计分，这一位永远是 ${left}。`, null))
      }
    }
  }
  if (!marked.length) {
    issues.push(issue('warning', 'personality_no_display', '人格测试已开启，但没有结局勾选「显示人格结果」，玩家看不到结果。', null))
  }
  return issues
}

function achievementIssues(program: StoryProgram): StoryIssue[] {
  const achievements = program.achievements ?? []
  const issues: StoryIssue[] = []
  const nodeAt = (projectId: string, nodeId: string) => program.chapters.find((chapter) => chapter.projectId === projectId)?.nodes.find((node) => node.id === nodeId)
  const hasEndings = program.chapters.some((chapter) => chapter.nodes.some((node) => node.kind === 'ending'))
  for (const item of achievements) {
    const name = item.name.trim() || '未命名成就'
    if (!item.name.trim()) issues.push(issue('warning', 'achievement_name', '有成就没有名字。', null))
    const { condition } = item
    if (condition.type === 'ending' && nodeAt(condition.projectId, condition.nodeId)?.kind !== 'ending') {
      issues.push(issue('error', 'achievement_unknown_ending', `成就「${name}」要求到达的结局已被删除，请重新选择。`, null))
    } else if (condition.type === 'segment' && nodeAt(condition.projectId, condition.nodeId)?.kind !== 'scene') {
      issues.push(issue('error', 'achievement_unknown_segment', `成就「${name}」要求到达的片段已被删除，请重新选择。`, null))
    } else if (condition.type === 'value' && !program.variables.some((variable) => variable.id === condition.variableId)) {
      issues.push(issue('error', 'unknown_variable', `成就「${name}」引用了不存在的数值。`, null))
    } else if (condition.type === 'all_endings' && !hasEndings) {
      issues.push(issue('warning', 'achievement_all_endings_empty', `成就「${name}」要集齐所有结局，但故事还没有任何结局。`, null))
    } else if (condition.type === 'all_achievements' && !achievements.some((other) => other.id !== item.id && other.condition.type !== 'all_achievements')) {
      issues.push(issue('warning', 'achievement_all_achievements_empty', `成就「${name}」要完成所有成就，但还没有其他成就可完成。`, null))
    }
  }
  return issues
}

function mapIssues(program: StoryProgram): StoryIssue[] {
  const points = program.chapters.reduce((count, chapter) => count + chapter.nodes.filter((node) => node.kind === 'scene' && node.savePoint).length, 0)
  if (program.map?.enabled && !points) {
    return [issue('warning', 'map_no_save_points', '地图存档已开启，但还没有任何片段设为存档点，地图是空的。', null)]
  }
  if (!program.map?.enabled && points) {
    return [issue('warning', 'save_points_map_off', `有 ${points} 个片段设为存档点，但玩法设置里没有开启地图存档，玩家看不到地图也不能存档。`, null)]
  }
  return []
}

export function validateChapter(chapter: StoryChapterGraph, variables: StoryVariable[], shop?: StoryShop): StoryIssue[] {
  const { projectId, nodes, flows } = chapter
  const issues: StoryIssue[] = []
  const out = (id: string) => flows.filter((flow) => flow.from === id)
  const entries = nodes.filter((node) => node.kind === 'entry')
  if (!entries.length) issues.push(issue('error', 'no_entry', '本章没有入口节点。', projectId))
  if (!nodes.some((node) => node.kind === 'exit' || node.kind === 'ending')) {
    issues.push(issue('error', 'no_terminal', '本章没有出口或结局。', projectId))
  }

  for (const node of nodes) {
    const handles = new Set(out(node.id).map((flow) => flow.handle))
    if (node.kind === 'entry' && !handles.size) {
      issues.push(issue('error', 'dead_end', `「${node.title}」之后没有连接后续剧情。`, projectId, node.id))
    }
    if (node.kind === 'scene') {
      if (!handles.size && !sceneEndsInBeatCuts(node, flows)) {
        issues.push(issue('error', 'dead_end', `「${node.title}」之后没有连接后续剧情。`, projectId, node.id))
      }
      if (!node.media) issues.push(issue('warning', 'scene_no_media', `片段「${node.title}」还没有画面。`, projectId, node.id))
      issues.push(...effectIssues(node, node.effects, variables, projectId))
      issues.push(...beatIssues(node, projectId))
    }
    if (node.kind === 'interaction') {
      issues.push(...interactionIssues(node, handles, variables, shop, projectId))
      if (node.mountedOn && flows.some((flow) => flow.to === node.id)) {
        issues.push(issue('error', 'mount_and_flow', `互动「${node.title}」既挂在片段上又被连线进入，请只保留一种。`, projectId, node.id))
      }
    }
    if (node.kind === 'choice') {
      if (!node.options.length) issues.push(issue('error', 'choice_empty', `选择「${node.title}」没有选项。`, projectId, node.id))
      else if (node.options.length === 1) issues.push(issue('warning', 'choice_single', `选择「${node.title}」只有一个选项。`, projectId, node.id))
      for (const option of node.options) {
        const name = option.label.trim() || '未命名选项'
        if (!option.label.trim()) issues.push(issue('warning', 'option_label', `选择「${node.title}」有选项没有文案。`, projectId, node.id))
        if (!handles.has(option.id)) issues.push(issue('error', 'option_unlinked', `选项「${name}」还没有连接后续剧情。`, projectId, node.id))
        issues.push(...effectIssues(node, option.effects, variables, projectId))
      }
      if (node.timeoutSec && node.timeoutMode !== 'exit' && !node.defaultOptionId && node.options.length) {
        issues.push(issue('warning', 'choice_timeout_default', `选择「${node.title}」有倒计时但没有默认选项，超时将选第一个。`, projectId, node.id))
      }
      const timeoutExit = !!node.timeoutSec && node.timeoutMode === 'exit'
      if (timeoutExit && !handles.has(STORY_TIMEOUT_HANDLE)) {
        issues.push(issue('error', 'timeout_unlinked', `选择「${node.title}」的「超时」还没有连接后续剧情。`, projectId, node.id))
      }
      if (node.panelStyle !== 'text' && node.options.some((option) => !option.imageUrl)) {
        issues.push(issue('error', 'choice_image_missing', `选择「${node.title}」选了图片版式，但有选项没有图片。`, projectId, node.id))
      }
      const known = new Set([...node.options.map((option) => option.id), ...(timeoutExit ? [STORY_TIMEOUT_HANDLE] : [])])
      if ([...handles].some((handle) => !known.has(handle))) {
        issues.push(issue('warning', 'stale_flow', `选择「${node.title}」有连线指向已删除的选项。`, projectId, node.id))
      }
      issues.push(...optionUnlockIssues(node, '选择', node.options, variables, shop, projectId))
    }
    if (node.kind === 'condition') {
      if (!node.branches.length) issues.push(issue('warning', 'condition_empty', `条件「${node.title}」没有分支，总会走「否则」。`, projectId, node.id))
      for (const branch of node.branches) {
        const name = branch.label.trim() || '未命名分支'
        if (!branch.conditions.length) issues.push(issue('warning', 'branch_empty', `分支「${name}」没有判断条件，不会被命中。`, projectId, node.id))
        if (!handles.has(branch.id)) issues.push(issue('error', 'branch_unlinked', `分支「${name}」还没有连接后续剧情。`, projectId, node.id))
        if (branch.conditions.some((condition) => !variables.some((variable) => variable.id === condition.variableId))) {
          issues.push(issue('error', 'unknown_variable', `分支「${name}」引用了不存在的变量。`, projectId, node.id))
        }
      }
      if (!handles.has(STORY_ELSE_HANDLE)) issues.push(issue('error', 'else_unlinked', `条件「${node.title}」的「否则」还没有连接。`, projectId, node.id))
      const known = new Set([...node.branches.map((branch) => branch.id), STORY_ELSE_HANDLE])
      if ([...handles].some((handle) => !known.has(handle))) {
        issues.push(issue('warning', 'stale_flow', `条件「${node.title}」有连线指向已删除的分支。`, projectId, node.id))
      }
    }
  }

  const reached = new Set(entries.map((node) => node.id))
  const queue = [...reached]
  const byId = new Map(nodes.map((node) => [node.id, node]))
  while (queue.length) {
    const id = queue.shift() as string
    const current = byId.get(id)
    const next = [...out(id).map((flow) => flow.to), ...(current?.kind === 'scene' ? current.beats.map((beat) => beat.id) : [])]
    for (const target of next) {
      if (reached.has(target)) continue
      reached.add(target)
      queue.push(target)
    }
  }
  for (const node of nodes) {
    if (!reached.has(node.id) && entries.length) {
      issues.push(issue('warning', 'unreachable', `「${node.title}」无法从入口到达。`, projectId, node.id))
    }
  }
  const loopNode = conditionLoopNode(chapter)
  if (loopNode) issues.push(issue('error', 'condition_loop', '条件节点之间形成了循环，试玩会卡住。', projectId, loopNode))
  return sortIssues(issues)
}

export function validateStory(program: StoryProgram): StoryIssue[] {
  const issues: StoryIssue[] = []
  const chapters = new Map(program.chapters.map((chapter) => [chapter.projectId, chapter]))
  const nodeOf = (projectId: string, nodeId: string) => chapters.get(projectId)?.nodes.find((node) => node.id === nodeId)
  if (!program.chapters.length) return [issue('error', 'no_chapters', '还没有章节。', null)]

  const { start } = program
  if (!start) issues.push(issue('error', 'no_start', '还没有设置故事起点。', null))
  else if (nodeOf(start.projectId, start.entryNodeId)?.kind !== 'entry') {
    issues.push(issue('error', 'start_invalid', '故事起点指向的入口已被删除。', start.projectId, start.entryNodeId))
  }
  const cycle = findStoryLinkCycle(program.links)
  if (cycle) {
    issues.push(issue('error', 'chapter_cycle', `章节「${chapters.get(cycle)?.title ?? cycle}」的连线形成了循环。`, cycle))
  }

  issues.push(
    ...variableIssues(program.variables),
    ...shopIssues(program.shop, program.variables),
    ...personalityIssues(program),
    ...achievementIssues(program),
    ...mapIssues(program),
  )
  for (const chapter of program.chapters) issues.push(...validateChapter(chapter, program.variables, program.shop))

  const validLinks = program.links.filter((link) => {
    const ok = nodeOf(link.fromProjectId, link.exitNodeId)?.kind === 'exit' && nodeOf(link.toProjectId, link.toEntryNodeId)?.kind === 'entry'
    if (!ok) issues.push(issue('error', 'link_invalid', '有章节连线指向已删除的出口或入口。', link.fromProjectId, link.exitNodeId))
    return ok
  })
  const linkedEntries = new Set(validLinks.map((link) => `${link.toProjectId}:${link.toEntryNodeId}`))
  for (const chapter of program.chapters) {
    for (const node of chapter.nodes) {
      if (node.kind === 'exit' && !validLinks.some((link) => link.fromProjectId === chapter.projectId && link.exitNodeId === node.id)) {
        issues.push(issue('error', 'exit_unlinked', `「${chapter.title}」的出口「${node.title}」还没有连接到下一章。`, chapter.projectId, node.id))
      }
      const isStart = start?.projectId === chapter.projectId && start.entryNodeId === node.id
      if (node.kind === 'entry' && !isStart && !linkedEntries.has(`${chapter.projectId}:${node.id}`)) {
        issues.push(issue('warning', 'entry_unlinked', `「${chapter.title}」的入口「${node.title}」没有被任何章节连入。`, chapter.projectId, node.id))
      }
    }
  }

  if (!program.chapters.some((chapter) => chapter.nodes.some((node) => node.kind === 'ending'))) {
    issues.push(issue('error', 'no_ending', '故事还没有任何结局。', null))
  }

  if (start && chapters.has(start.projectId)) {
    const reached = new Set([start.projectId])
    const queue = [start.projectId]
    while (queue.length) {
      const id = queue.shift() as string
      for (const link of validLinks) {
        if (link.fromProjectId !== id || reached.has(link.toProjectId)) continue
        reached.add(link.toProjectId)
        queue.push(link.toProjectId)
      }
    }
    for (const chapter of program.chapters) {
      if (!reached.has(chapter.projectId)) {
        issues.push(issue('warning', 'chapter_unreachable', `章节「${chapter.title}」无法从起点到达。`, chapter.projectId))
      }
    }
  }
  return sortIssues(issues)
}

/** Orphaned work-canvas segments are surfaced instead of being silently removed from config. */
export function validateSequence(sequence: StorySequence, chapters: StoryChapterGraph[]): StoryIssue[] {
  const issues: StoryIssue[] = []
  const chapterById = new Map(chapters.map((chapter) => [chapter.projectId, chapter]))
  const ids = new Set<string>()
  const scenes = new Set<string>()
  for (const segment of sequence.segments) {
    const title = segment.title.trim() || '未命名作品片段'
    if (ids.has(segment.id)) issues.push(issue('error', 'segment_duplicate_id', `作品片段「${title}」的 ID 重复。`, segment.projectId, segment.sceneNodeId))
    ids.add(segment.id)
    const sceneKey = `${segment.projectId}:${segment.sceneNodeId}`
    if (scenes.has(sceneKey)) issues.push(issue('error', 'segment_duplicate_scene', `剧情片段「${title}」关联了多个作品片段。`, segment.projectId, segment.sceneNodeId))
    scenes.add(sceneKey)
    const chapter = chapterById.get(segment.projectId)
    if (!chapter) {
      issues.push(issue('error', 'segment_orphan_project', `作品片段「${title}」所属的章节已被删除，请移除该引用或恢复章节。`, segment.projectId, segment.sceneNodeId))
      continue
    }
    const scene = chapter.nodes.find((node) => node.id === segment.sceneNodeId)
    if (!scene || scene.kind !== 'scene') {
      issues.push(issue('error', 'segment_orphan_scene', `作品片段「${title}」关联的剧情片段已被删除，请移除该引用或恢复剧情片段。`, segment.projectId, segment.sceneNodeId))
    }
  }
  return sortIssues(issues)
}

export function sortIssues(issues: StoryIssue[]): StoryIssue[] {
  return [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}

export function countIssues(issues: StoryIssue[]) {
  return {
    errors: issues.filter((item) => item.level === 'error').length,
    warnings: issues.filter((item) => item.level === 'warning').length,
  }
}
