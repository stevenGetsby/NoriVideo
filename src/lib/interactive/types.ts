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
  'story_interaction',
] as const
export type StoryNodeType = (typeof STORY_NODE_TYPES)[number]

export const STORY_FLOW_ROLE = 'STORY_FLOW' as const
export const STORY_ELSE_HANDLE = 'else' as const
export const STORY_OUTPUT_HANDLE = 'output' as const
/** Edge role for "this interaction is mounted on that scene's timeline"; never part of the story flow. */
export const STORY_MOUNT_ROLE = 'STORY_MOUNT' as const
/** A scene's bottom port: only interaction nodes connect here. */
export const STORY_INTERACT_HANDLE = 'interact' as const
/** An interaction node's top port that receives the mount. */
export const STORY_MOUNT_HANDLE = 'mount' as const
export const STORY_TIMEOUT_HANDLE = 'timeout' as const

export type StoryValue = number | boolean
export type StoryVariableType = 'number' | 'boolean'
export type StoryVariables = Record<string, StoryValue>

export const STORY_VARIABLE_SCOPES = ['run', 'permanent'] as const
export type StoryVariableScope = (typeof STORY_VARIABLE_SCOPES)[number]

export interface StoryVariable {
  id: string
  name: string
  type: StoryVariableType
  initial: StoryValue
  /** An emoji or an uploaded picture URL shown beside the value in the viewer's top-right bar. */
  icon?: string | null
  /** Show the value in the viewer's top-right bar. */
  showInHud?: boolean
  /** Upper bound of a number value; effects and purchases never push it higher. */
  max?: number | null
  /** 'permanent' values survive between plays (kept in the viewer's browser); the default resets every play. */
  scope?: StoryVariableScope
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

export type StoryCutWhen = 'now' | 'after'

export const STORY_UNLOCK_MODES = ['hidden', 'locked'] as const
export type StoryUnlockMode = (typeof STORY_UNLOCK_MODES)[number]

/** Keeps an option away from the viewer until its conditions hold: left out entirely, or shown with a lock. */
export interface StoryOptionUnlock {
  mode: StoryUnlockMode
  match: 'all' | 'any'
  conditions: StoryCondition[]
  /** The shop item a locked card sends the viewer to, so that buying it opens the option. */
  shopItemId: string | null
}

export interface StoryChoiceOption {
  id: string
  label: string
  effects: StoryEffect[]
  imageUrl: string | null
  /** Only used by a mounted choice: cut at once or wait for the segment to finish. */
  when: StoryCutWhen
  /** Only used by a mounted choice: rewind and ask again instead of branching. */
  retry: boolean
  /** Only used by a choice interaction: positive weights settle by one random draw. */
  weight?: number
  /** Absent = always available. */
  unlock?: StoryOptionUnlock
  /** Personality-test letters this option scores; absent = scores nothing. */
  tags?: StoryPersonalityTag[]
}

export const STORY_CHOICE_PANELS = ['text', 'image', 'both'] as const
export type StoryChoicePanel = (typeof STORY_CHOICE_PANELS)[number]
export const STORY_CHOICE_LAYOUTS = ['auto', 'horizontal', 'vertical'] as const
export type StoryChoiceLayout = (typeof STORY_CHOICE_LAYOUTS)[number]
export const STORY_TIMEOUT_MODES = ['default', 'exit'] as const
export type StoryTimeoutMode = (typeof STORY_TIMEOUT_MODES)[number]

export const STORY_INTERACTION_KINDS = ['choice', 'tap', 'swipe', 'timing', 'hold', 'hotspot'] as const
export type StoryInteractionKind = (typeof STORY_INTERACTION_KINDS)[number]
export const STORY_SWIPE_DIRECTIONS = ['up', 'down', 'left', 'right'] as const
export type StorySwipeDirection = (typeof STORY_SWIPE_DIRECTIONS)[number]
export const STORY_BEAT_DURINGS = ['play', 'slow', 'freeze'] as const
export type StoryBeatDuring = (typeof STORY_BEAT_DURINGS)[number]

/** What one result port of an interaction does besides branching. */
export interface StoryResultConfig {
  effects: StoryEffect[]
  when: StoryCutWhen
  retry: boolean
  /** Positive weights make this interaction settle by one random draw; absent keeps the original result. */
  weight?: number
}

export type StoryHotspotZone = {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export type StoryInteractionSpec =
  | { type: 'tap'; count: number; buttonText: string; buttonImageUrl: string | null }
  | { type: 'swipe'; direction: StorySwipeDirection; buttonText: string; buttonImageUrl: string | null }
  | { type: 'timing'; propImageUrl: string | null; speed: number; perfectWidth: number; normalWidth: number }
  | { type: 'hold'; fillSec: number; rangeMin: number; rangeMax: number; overchargeFails: boolean; buttonText: string; buttonImageUrl: string | null }
  | { type: 'hotspot'; frameImageUrl: string | null; showZones: boolean; zones: StoryHotspotZone[] }
  | {
    type: 'choice'
    prompt: string
    options: StoryChoiceOption[]
    panelStyle: StoryChoicePanel
    layout: StoryChoiceLayout
    timeoutMode: StoryTimeoutMode
    defaultOptionId: string | null
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
  /** Known video length in seconds; absent when the source never recorded it. */
  durationSec?: number
}

interface StoryNodeBase { id: string; title: string }
export interface StoryEntryNode extends StoryNodeBase { kind: 'entry' }
export interface StoryExitNode extends StoryNodeBase { kind: 'exit' }
export interface StorySceneNode extends StoryNodeBase {
  kind: 'scene'
  lines: string
  media: StoryMedia | null
  effects: StoryEffect[]
  /** Interactions mounted on this scene's timeline, sorted by start second. */
  beats: StoryInteractionNode[]
  /** Absent = not a save point. */
  savePoint?: StorySavePoint
}
export interface StoryChoiceNode extends StoryNodeBase {
  kind: 'choice'
  prompt: string
  options: StoryChoiceOption[]
  timeoutSec: number | null
  defaultOptionId: string | null
  panelStyle: StoryChoicePanel
  layout: StoryChoiceLayout
  timeoutMode: StoryTimeoutMode
  /** Optional backdrop behind the choice panel: a video/image wired into this node's top picture port
   *  on the canvas. Absent falls back to the previous scene's last frame. */
  backdrop?: StoryMedia | null
}
export interface StoryInteractionNode extends StoryNodeBase {
  kind: 'interaction'
  spec: StoryInteractionSpec
  hint: string
  /** The time limit in real seconds (a choice's countdown). */
  durationSec: number
  during: StoryBeatDuring
  /** Scene node id when mounted on a timeline, null when it sits in the flow. */
  mountedOn: string | null
  /** Video second at which a mounted interaction appears. */
  startSec: number
  /** Per result port (tap/swipe/hold success|fail, timing perfect|normal|miss, choice timeout). */
  results: Record<string, StoryResultConfig>
  /** 独立摆放时的底图：画面节点连进来的视频或图片。挂载时恒为 null（画面跟随宿主片段）。
   *  缺省 = 没有自己的画面，播放器回退到上一段最后一帧，再回退到占位。 */
  picture?: StoryMedia | null
}
export interface StoryConditionNode extends StoryNodeBase {
  kind: 'condition'
  branches: StoryConditionBranch[]
}
export interface StoryEndingNode extends StoryNodeBase {
  kind: 'ending'
  endingType: StoryEndingType
  description: string
  /** Show the viewer's personality-test result on this ending. */
  showPersonality?: boolean
}
export type StoryNode =
  | StoryEntryNode
  | StorySceneNode
  | StoryChoiceNode
  | StoryConditionNode
  | StoryExitNode
  | StoryEndingNode
  | StoryInteractionNode
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

/**
 * One 作品级大视频片段: the linear-cut slot that a story scene owns.
 * `branch` segments are kept so the story tree is never flattened away, but
 * they are never part of the linear final cut. `removed` is the recoverable
 * "taken out of the cut" state; orphaned segments (deleted chapter/scene) stay
 * in the config so the UI can show a warning instead of silently dropping them.
 */
export interface StorySequenceSegment {
  id: string
  projectId: string
  sceneNodeId: string
  title: string
  branch: boolean
  removed: boolean
}

export interface StorySequence {
  segments: StorySequenceSegment[]
}

export interface StoryShopItem {
  id: string
  name: string
  /** An emoji or an uploaded picture URL. */
  icon: string | null
  description: string
  price: number
  /** How many times one play may buy it; 0 = no limit. */
  limit: number
  /** Values the item gives when bought. */
  effects: StoryEffect[]
  /** A title or avatar frame the viewer keeps once they buy it. */
  reward?: StoryReward
}

export interface StoryShop {
  enabled: boolean
  /** The number value the price is paid in; null = the price is only a label and buying is a free simulation. */
  currencyVariableId: string | null
  items: StoryShopItem[]
}

export const STORY_PERSONALITY_TAGS = ['E', 'I', 'S', 'N', 'T', 'F', 'J', 'P'] as const
export type StoryPersonalityTag = (typeof STORY_PERSONALITY_TAGS)[number]
/** The four pairs of letters; a type takes whichever letter of each pair scored higher. */
export const STORY_PERSONALITY_AXES: readonly (readonly [StoryPersonalityTag, StoryPersonalityTag])[] = [
  ['E', 'I'],
  ['S', 'N'],
  ['T', 'F'],
  ['J', 'P'],
]

export interface StoryPersonalityResult {
  name: string
  description: string
  imageUrl: string | null
}

export interface StoryPersonality {
  enabled: boolean
  /** Keyed by the four-letter type (ISTJ … ENTJ); a type without an entry shows its built-in name. */
  results: Record<string, StoryPersonalityResult>
}

/** What a viewer keeps for finishing something: a title shown under their name and/or an avatar frame. */
export interface StoryReward {
  title: string
  frameUrl: string | null
}

export type StoryAchievementCondition =
  | { type: 'ending'; projectId: string; nodeId: string }
  | { type: 'segment'; projectId: string; nodeId: string }
  | { type: 'value'; variableId: string; op: StoryCompareOp; value: StoryValue }
  | { type: 'all_endings' }
  | { type: 'all_achievements' }
export type StoryAchievementConditionType = StoryAchievementCondition['type']
export const STORY_ACHIEVEMENT_CONDITION_TYPES: readonly StoryAchievementConditionType[] = ['ending', 'segment', 'value', 'all_endings', 'all_achievements']

export interface StoryAchievement {
  id: string
  name: string
  description: string
  /** An emoji or an uploaded picture URL. */
  icon: string | null
  condition: StoryAchievementCondition
  reward: StoryReward
}

/** A save point the creator marked on a segment. */
export interface StorySavePoint {
  name: string
  coverUrl: string | null
}

export interface StoryMapConfig {
  enabled: boolean
}

export const STORY_PLAYBACK_SPEEDS = [1, 1.25, 1.5] as const
export type StoryPlaybackSpeed = (typeof STORY_PLAYBACK_SPEEDS)[number]

export interface StoryPlaybackConfig {
  /** The speeds a viewer can switch between; 1x is always on offer, whatever is stored. */
  speeds: StoryPlaybackSpeed[]
}

export interface InteractiveStoryConfig {
  version: 1
  variables: StoryVariable[]
  chapters: StoryChapterMeta[]
  links: StoryLink[]
  start: StoryStart | null
  /**
   * Optional so configs written before the work canvas existed keep working.
   * When absent the server derives it from chapter order and the scene graph.
   */
  sequence?: StorySequence
  /** Optional so older works open unchanged. */
  shop?: StoryShop
  achievements?: StoryAchievement[]
  personality?: StoryPersonality
  map?: StoryMapConfig
  playback?: StoryPlaybackConfig
}

export interface StoryProgram {
  variables: StoryVariable[]
  chapters: StoryChapterGraph[]
  links: StoryLink[]
  start: StoryStart | null
  shop?: StoryShop
  achievements?: StoryAchievement[]
  personality?: StoryPersonality
  map?: StoryMapConfig
  playback?: StoryPlaybackConfig
}

export type StoryIssueLevel = 'error' | 'warning'
export interface StoryIssue {
  level: StoryIssueLevel
  code: string
  message: string
  projectId: string | null
  nodeId: string | null
}
