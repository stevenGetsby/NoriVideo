import {
  STORY_ELSE_HANDLE,
  type StoryChapterGraph,
  type StoryEffect,
  type StoryIssue,
  type StoryIssueLevel,
  type StoryNode,
  type StoryProgram,
  type StoryVariable,
} from './types'

function issue(level: StoryIssueLevel, code: string, message: string, projectId: string | null, nodeId: string | null = null): StoryIssue {
  return { level, code, message, projectId, nodeId }
}

function effectIssues(owner: StoryNode, effects: StoryEffect[], variables: StoryVariable[], projectId: string): StoryIssue[] {
  return effects.flatMap((effect) => {
    const variable = variables.find((item) => item.id === effect.variableId)
    if (!variable) return [issue('error', 'unknown_variable', `「${owner.title}」修改了不存在的变量。`, projectId, owner.id)]
    if (effect.op === 'add' && variable.type === 'boolean') {
      return [issue('error', 'effect_add_boolean', `「${owner.title}」不能对开关变量「${variable.name}」做加减。`, projectId, owner.id)]
    }
    return []
  })
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

export function validateChapter(chapter: StoryChapterGraph, variables: StoryVariable[]): StoryIssue[] {
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
    if ((node.kind === 'entry' || node.kind === 'scene') && !handles.size) {
      issues.push(issue('error', 'dead_end', `「${node.title}」之后没有连接后续剧情。`, projectId, node.id))
    }
    if (node.kind === 'scene') {
      if (!node.media) issues.push(issue('warning', 'scene_no_media', `片段「${node.title}」还没有画面。`, projectId, node.id))
      issues.push(...effectIssues(node, node.effects, variables, projectId))
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
      if (node.timeoutSec && !node.defaultOptionId && node.options.length) {
        issues.push(issue('warning', 'choice_timeout_default', `选择「${node.title}」有倒计时但没有默认选项，超时将选第一个。`, projectId, node.id))
      }
      const known = new Set(node.options.map((option) => option.id))
      if ([...handles].some((handle) => !known.has(handle))) {
        issues.push(issue('warning', 'stale_flow', `选择「${node.title}」有连线指向已删除的选项。`, projectId, node.id))
      }
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
  while (queue.length) {
    const id = queue.shift() as string
    for (const flow of out(id)) {
      if (reached.has(flow.to)) continue
      reached.add(flow.to)
      queue.push(flow.to)
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

  for (const chapter of program.chapters) issues.push(...validateChapter(chapter, program.variables))

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

export function sortIssues(issues: StoryIssue[]): StoryIssue[] {
  return [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}

export function countIssues(issues: StoryIssue[]) {
  return {
    errors: issues.filter((item) => item.level === 'error').length,
    warnings: issues.filter((item) => item.level === 'warning').length,
  }
}
