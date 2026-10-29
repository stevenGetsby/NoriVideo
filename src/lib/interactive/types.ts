export const STORY_ASPECT_RATIOS = ['9:16', '16:9'] as const
export type StoryAspectRatio = (typeof STORY_ASPECT_RATIOS)[number]

export const STORY_RESOLUTIONS = ['480p', '720p', '1080p', '4K'] as const
export type StoryResolution = (typeof STORY_RESOLUTIONS)[number]

export const STORY_NODE_TYPES = [
  'story_entry',
  'story_scene',
  'story_choice',
  'story_condition',
  'story_exit',
  'story_ending',
] as const
export type StoryNodeType = (typeof STORY_NODE_TYPES)[number]

export const STORY_FLOW_ROLE = 'STORY_FLOW' as const
export const STORY_ELSE_HANDLE = 'else' as const
export const STORY_OUTPUT_HANDLE = 'output' as const

export type StoryValue = number | boolean
export type StoryVariableType = 'number' | 'boolean'
export type StoryVariables = Record<string, StoryValue>

export interface StoryVariable {
  id: string
  name: string
  type: StoryVariableType
  initial: StoryValue
}

export type StoryEffectOp = 'set' | 'add'
export interface StoryEffect {
  variableId: string
  op: StoryEffectOp
  value: StoryValue
}

export const STORY_COMPARE_OPS = ['==', '!=', '>', '>=', '<', '<='] as const
export type StoryCompareOp = (typeof STORY_COMPARE_OPS)[number]
export interface StoryCondition {
  variableId: string
  op: StoryCompareOp
  value: StoryValue
}

export interface StoryChoiceOption {
  id: string
  label: string
  effects: StoryEffect[]
}

export interface StoryConditionBranch {
  id: string
  label: string
  match: 'all' | 'any'
  conditions: StoryCondition[]
}

export const STORY_ENDING_TYPES = ['good', 'normal', 'bad', 'hidden'] as const
export type StoryEndingType = (typeof STORY_ENDING_TYPES)[number]

export interface StoryMedia {
  kind: 'video' | 'image'
  url: string
  posterUrl: string | null
}

interface StoryNodeBase { id: string; title: string }
export interface StoryEntryNode extends StoryNodeBase { kind: 'entry' }
export interface StoryExitNode extends StoryNodeBase { kind: 'exit' }
export interface StorySceneNode extends StoryNodeBase {
  kind: 'scene'
  lines: string
  media: StoryMedia | null
  effects: StoryEffect[]
}
export interface StoryChoiceNode extends StoryNodeBase {
  kind: 'choice'
  prompt: string
  options: StoryChoiceOption[]
  timeoutSec: number | null
  defaultOptionId: string | null
}
export interface StoryConditionNode extends StoryNodeBase {
  kind: 'condition'
  branches: StoryConditionBranch[]
}
export interface StoryEndingNode extends StoryNodeBase {
  kind: 'ending'
  endingType: StoryEndingType
  description: string
}
export type StoryNode =
  | StoryEntryNode
  | StorySceneNode
  | StoryChoiceNode
  | StoryConditionNode
  | StoryExitNode
  | StoryEndingNode
export type StoryNodeKind = StoryNode['kind']

export interface StoryFlow {
  id: string
  from: string
  handle: string
  to: string
}

export interface StoryChapterGraph {
  projectId: string
  title: string
  nodes: StoryNode[]
  flows: StoryFlow[]
}

export const STORY_CHAPTER_STATUSES = ['drafting', 'generating', 'review', 'final'] as const
export type StoryChapterStatus = (typeof STORY_CHAPTER_STATUSES)[number]

export interface StoryChapterMeta {
  projectId: string
  order: number
  position: { x: number; y: number }
  status: StoryChapterStatus
}

export interface StoryLink {
  id: string
  fromProjectId: string
  exitNodeId: string
  toProjectId: string
  toEntryNodeId: string
}

export interface StoryStart {
  projectId: string
  entryNodeId: string
}

export interface InteractiveStoryConfig {
  version: 1
  variables: StoryVariable[]
  chapters: StoryChapterMeta[]
  links: StoryLink[]
  start: StoryStart | null
}

export interface StoryProgram {
  variables: StoryVariable[]
  chapters: StoryChapterGraph[]
  links: StoryLink[]
  start: StoryStart | null
}

export type StoryIssueLevel = 'error' | 'warning'
export interface StoryIssue {
  level: StoryIssueLevel
  code: string
  message: string
  projectId: string | null
  nodeId: string | null
}
