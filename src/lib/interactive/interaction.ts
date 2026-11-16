import {
  STORY_BEAT_DURINGS,
  STORY_CHOICE_LAYOUTS,
  STORY_CHOICE_PANELS,
  STORY_INTERACTION_KINDS,
  STORY_SWIPE_DIRECTIONS,
  STORY_TIMEOUT_HANDLE,
  STORY_TIMEOUT_MODES,
  type StoryBeatDuring,
  type StoryChoiceLayout,
  type StoryChoiceOption,
  type StoryChoicePanel,
  type StoryCutWhen,
  type StoryInteractionKind,
  type StoryInteractionNode,
  type StoryInteractionSpec,
  type StoryHotspotZone,
  type StoryOptionUnlock,
  type StoryResultConfig,
  type StorySwipeDirection,
  type StoryTimeoutMode,
} from './types'
import { boundedNumber, id, readStoryConditions, readStoryEffects, record, text } from './read'
import { readPersonalityTags } from './personality'

export const STORY_INTERACTION_LABEL: Record<StoryInteractionKind, string> = {
  choice: '限时抉择',
  tap: '快速点击',
  swipe: '方向滑动',
  timing: '时机点击',
  hold: '长按蓄力',
  hotspot: '隐藏热区',
}

/** Shown to the viewer when the creator left the hint empty. */
export const STORY_INTERACTION_DEFAULT_HINT: Record<StoryInteractionKind, string> = {
  choice: '请做出选择',
  tap: '快速点击！',
  swipe: '快速滑动！',
  timing: '看准时机点击！',
  hold: '长按蓄力，到位松手！',
  hotspot: '找出画面里的线索！',
}

export const STORY_SWIPE_LABEL: Record<StorySwipeDirection, string> = { up: '向上', down: '向下', left: '向左', right: '向右' }
export const STORY_DURING_LABEL: Record<StoryBeatDuring, string> = { play: '画面继续', slow: '画面慢放', freeze: '画面定格' }
export const STORY_CHOICE_COUNTDOWNS = [1, 2, 3, 5, 10] as const
/** A mounted choice offers 2-4 options; the standalone choice node keeps its larger limit. */
export const STORY_MOUNTED_CHOICE_MAX_OPTIONS = 4
export const STORY_RETRY_REWIND_SEC = 2
export const STORY_SLOW_RATE = 0.25
export const STORY_BEAT_MAX_SEC = 3600

const RESULT_LABEL: Record<string, string> = {
  success: '成功',
  fail: '失败',
  perfect: '完美',
  normal: '普通',
  miss: '失误',
  [STORY_TIMEOUT_HANDLE]: '超时',
}

const DEFAULT_DURATION: Record<StoryInteractionKind, number> = { choice: 3, tap: 3, swipe: 1, timing: 3, hold: 4, hotspot: 5 }

export const isInteractionKind = (value: unknown): value is StoryInteractionKind =>
  STORY_INTERACTION_KINDS.includes(value as StoryInteractionKind)

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (list.includes(value as T) ? value as T : fallback)
const tenths = (value: number) => Math.round(value * 10) / 10

export function readCutWhen(value: unknown): StoryCutWhen {
  return value === 'after' ? 'after' : 'now'
}

/** An unlock without any condition would never close, so it reads as no unlock at all. */
export function readOptionUnlock(raw: unknown): StoryOptionUnlock | null {
  const data = record(raw)
  const conditions = readStoryConditions(data.conditions)
  if (!conditions.length) return null
  return {
    mode: data.mode === 'locked' ? 'locked' : 'hidden',
    match: data.match === 'any' ? 'any' : 'all',
    conditions,
    shopItemId: id(data.shopItemId),
  }
}

export function readChoiceOptions(raw: unknown): StoryChoiceOption[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    const option = record(item)
    const optionId = id(option.id)
    if (!optionId) return []
    const unlock = readOptionUnlock(option.unlock)
    const tags = readPersonalityTags(option.tags)
    return [{
      id: optionId,
      label: text(option.label),
      effects: readStoryEffects(option.effects),
      imageUrl: id(option.imageUrl),
      when: readCutWhen(option.when),
      retry: option.retry === true,
      ...(boundedNumber(option.weight, 0, 0, 999) > 0 ? { weight: boundedNumber(option.weight, 0, 0, 999) } : {}),
      ...(unlock ? { unlock } : {}),
      ...(tags.length ? { tags } : {}),
    } satisfies StoryChoiceOption]
  })
}

export function readChoicePresentation(data: Record<string, unknown>): { panelStyle: StoryChoicePanel; layout: StoryChoiceLayout; timeoutMode: StoryTimeoutMode } {
  return {
    panelStyle: oneOf(STORY_CHOICE_PANELS, data.panelStyle, 'text'),
    layout: oneOf(STORY_CHOICE_LAYOUTS, data.layout, 'auto'),
    timeoutMode: oneOf(STORY_TIMEOUT_MODES, data.timeoutMode, 'default'),
  }
}

export function readResultConfig(raw: unknown): StoryResultConfig {
  const item = record(raw)
  return { effects: readStoryEffects(item.effects), when: readCutWhen(item.when), retry: item.retry === true, ...(boundedNumber(item.weight, 0, 0, 999) > 0 ? { weight: boundedNumber(item.weight, 0, 0, 999) } : {}) }
}

function readSpec(kind: StoryInteractionKind, data: Record<string, unknown>): StoryInteractionSpec {
  const buttonText = text(data.buttonText)
  const buttonImageUrl = id(data.buttonImageUrl)
  switch (kind) {
    case 'tap':
      return { type: 'tap', count: Math.round(boundedNumber(data.count, 10, 1, 99)), buttonText, buttonImageUrl }
    case 'swipe':
      return { type: 'swipe', direction: oneOf(STORY_SWIPE_DIRECTIONS, data.direction, 'up'), buttonText, buttonImageUrl }
    case 'timing': {
      const perfectWidth = Math.round(boundedNumber(data.perfectWidth, 10, 2, 50))
      const normalWidth = Math.max(perfectWidth, Math.round(boundedNumber(data.normalWidth, 30, 4, 90)))
      return { type: 'timing', propImageUrl: id(data.propImageUrl), speed: boundedNumber(data.speed, 1, 0.25, 4), perfectWidth, normalWidth }
    }
    case 'hold': {
      const rangeMin = Math.round(boundedNumber(data.rangeMin, 80, 0, 100))
      const rangeMax = Math.max(rangeMin, Math.round(boundedNumber(data.rangeMax, 100, 0, 100)))
      return {
        type: 'hold',
        fillSec: boundedNumber(data.fillSec, 2, 0.5, 20),
        rangeMin,
        rangeMax,
        overchargeFails: data.overchargeFails === true,
        buttonText,
        buttonImageUrl,
      }
    }
    case 'hotspot':
      return {
        type: 'hotspot',
        frameImageUrl: id(data.frameImageUrl),
        showZones: data.showZones === true,
        zones: (Array.isArray(data.zones) ? data.zones : []).flatMap((raw) => {
          const zone = record(raw)
          const zoneId = id(zone.id)
          if (!zoneId) return []
          return [{
            id: zoneId,
            label: text(zone.label),
            x: boundedNumber(zone.x, 0.4, -1000, 1000),
            y: boundedNumber(zone.y, 0.4, -1000, 1000),
            w: boundedNumber(zone.w, 0.2, -1000, 1000),
            h: boundedNumber(zone.h, 0.2, -1000, 1000),
          }]
        }),
      }
    case 'choice': {
      const options = readChoiceOptions(data.options)
      const defaultOptionId = id(data.defaultOptionId)
      return {
        type: 'choice',
        prompt: text(data.prompt),
        options,
        ...readChoicePresentation(data),
        defaultOptionId: defaultOptionId && options.some((option) => option.id === defaultOptionId) ? defaultOptionId : null,
      }
    }
  }
}

/** Result ports of an interaction, in display order. */
export function interactionHandles(spec: StoryInteractionSpec): string[] {
  switch (spec.type) {
    case 'tap':
    case 'swipe':
    case 'hold':
      return ['success', 'fail']
    case 'timing':
      return ['perfect', 'normal', 'miss']
    case 'choice':
      return [...spec.options.map((option) => option.id), ...(spec.timeoutMode === 'exit' ? [STORY_TIMEOUT_HANDLE] : [])]
    case 'hotspot':
      return [...spec.zones.map((zone) => zone.id), STORY_TIMEOUT_HANDLE]
  }
}

export function interactionHandleLabel(spec: StoryInteractionSpec, handle: string): string {
  if (spec.type === 'choice') {
    const option = spec.options.find((item) => item.id === handle)
    if (option) return option.label.trim() || '未命名选项'
  }
  if (spec.type === 'hotspot') {
    const zone = spec.zones.find((item) => item.id === handle)
    if (zone) return zone.label.trim() || '未命名热区'
  }
  return RESULT_LABEL[handle] ?? handle
}

/** The handle the viewer lands on when the time limit runs out. */
export function interactionTimeoutHandle(spec: StoryInteractionSpec): string | null {
  switch (spec.type) {
    case 'tap':
    case 'swipe':
    case 'hold':
      return 'fail'
    case 'timing':
      return 'miss'
    case 'hotspot':
      return STORY_TIMEOUT_HANDLE
    case 'choice':
      return spec.timeoutMode === 'exit' ? STORY_TIMEOUT_HANDLE : spec.defaultOptionId ?? spec.options[0]?.id ?? null
  }
}

export interface InteractionData {
  title: string
  spec: StoryInteractionSpec
  hint: string
  durationSec: number
  during: StoryBeatDuring
  startSec: number
  results: Record<string, StoryResultConfig>
}

/** Lenient reader: any partial or hand-edited canvas node data yields a playable interaction. */
export function readInteractionData(raw: unknown): InteractionData {
  const data = record(raw)
  const kind = isInteractionKind(data.interaction) ? data.interaction : 'tap'
  const spec = readSpec(kind, data)
  const rawResults = record(data.results)
  const results: Record<string, StoryResultConfig> = {}
  for (const handle of interactionHandles(spec)) {
    const option = spec.type === 'choice' ? spec.options.find((item) => item.id === handle) : undefined
    results[handle] = option ? { effects: option.effects, when: option.when, retry: option.retry, ...(option.weight ? { weight: option.weight } : {}) } : readResultConfig(rawResults[handle])
  }
  return {
    title: text(data.title).trim() || STORY_INTERACTION_LABEL[kind],
    spec,
    hint: text(data.hint).trim(),
    durationSec: tenths(boundedNumber(data.durationSec, DEFAULT_DURATION[kind], 0.5, 120)),
    during: oneOf(STORY_BEAT_DURINGS, data.during, kind === 'choice' ? 'freeze' : 'play'),
    startSec: tenths(boundedNumber(data.startSec, 0, 0, STORY_BEAT_MAX_SEC)),
    results,
  }
}

/** Canvas node data for a fresh interaction of this kind. */
export function defaultInteractionData(kind: StoryInteractionKind, createId: () => string): Record<string, unknown> {
  const base = {
    title: STORY_INTERACTION_LABEL[kind],
    interaction: kind,
    startSec: 0,
    durationSec: DEFAULT_DURATION[kind],
    during: kind === 'choice' ? 'freeze' : 'play',
    hint: '',
  }
  switch (kind) {
    case 'tap': return { ...base, count: 10, buttonText: '', buttonImageUrl: null }
    case 'swipe': return { ...base, direction: 'up', buttonText: '', buttonImageUrl: null }
    case 'timing': return { ...base, propImageUrl: null, speed: 1, perfectWidth: 10, normalWidth: 30 }
    case 'hold': return { ...base, fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: false, buttonText: '', buttonImageUrl: null }
    case 'hotspot': return { ...base, frameImageUrl: null, showZones: false, zones: [{ id: createId(), label: '线索一', x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] }
    case 'choice': {
      const option = (label: string) => ({ id: createId(), label, effects: [], imageUrl: null, when: 'now', retry: false })
      return { ...base, prompt: '', options: [option('选项一'), option('选项二')], panelStyle: 'text', layout: 'auto', timeoutMode: 'default', defaultOptionId: null }
    }
  }
}

/** Which way an option card lays out its picture and text: 'horizontal' = picture left / text right, 'vertical' = picture top / text bottom. */
export function resolveChoiceLayout(layout: StoryChoiceLayout, orientation: 'portrait' | 'landscape'): 'horizontal' | 'vertical' {
  if (layout === 'horizontal' || layout === 'vertical') return layout
  return orientation === 'portrait' ? 'vertical' : 'horizontal'
}

/** What one option card shows. A picture-only card without a picture falls back to its text so it never renders empty. */
export function choiceOptionParts(panelStyle: StoryChoicePanel, option: { imageUrl?: string | null }): { image: boolean; text: boolean } {
  const hasImage = Boolean(option.imageUrl)
  if (panelStyle === 'text') return { image: false, text: true }
  if (panelStyle === 'image') return hasImage ? { image: true, text: false } : { image: false, text: true }
  return { image: hasImage, text: true }
}

const DEFAULT_RESULT: StoryResultConfig = { effects: [], when: 'now', retry: false }

/** What one result port of an interaction does: its value effects, cut timing and retry flag. */
export function beatResult(node: Pick<StoryInteractionNode, 'results'>, handle: string): StoryResultConfig {
  return node.results[handle] ?? DEFAULT_RESULT
}

export const hasRandomResults = (results: Record<string, StoryResultConfig>) =>
  Object.values(results).some((result) => typeof result.weight === 'number' && result.weight > 0)

/** Draws from the weighted ports in their display order. No weights means the viewer's result is unchanged. */
export function resolveRandomHandle(spec: StoryInteractionSpec, results: Record<string, StoryResultConfig>, roll: number): string | null {
  const weighted = interactionHandles(spec).flatMap((handle) => {
    const weight = results[handle]?.weight ?? 0
    return weight > 0 ? [{ handle, weight }] : []
  })
  const total = weighted.reduce((sum, item) => sum + item.weight, 0)
  if (!total) return null
  let cursor = Math.min(1 - Number.EPSILON, Math.max(0, roll)) * total
  for (const item of weighted) {
    if (cursor < item.weight) return item.handle
    cursor -= item.weight
  }
  return weighted[weighted.length - 1].handle
}

export function retargetHandleMap(prev: StoryInteractionSpec, next: StoryInteractionSpec): Map<string, string | null> {
  const map = new Map<string, string | null>()
  const simple = new Set<StoryInteractionKind>(['tap', 'swipe', 'hold'])
  const identity = prev.type === next.type
  const success = simple.has(next.type) ? 'success' : next.type === 'timing' ? 'normal' : null
  const failure = simple.has(next.type) ? 'fail' : next.type === 'timing' ? 'miss' : next.type === 'hotspot' || (next.type === 'choice' && next.timeoutMode === 'exit') ? STORY_TIMEOUT_HANDLE : null
  for (const handle of interactionHandles(prev)) {
    if (identity) map.set(handle, handle)
    else if (handle === STORY_TIMEOUT_HANDLE) {
      map.set(handle, failure)
    } else if (prev.type === 'choice' || prev.type === 'hotspot') {
      map.set(handle, next.type === prev.type ? handle : null)
    } else if (handle === 'perfect') {
      map.set(handle, simple.has(next.type) ? 'success' : null)
    } else if (handle === 'normal') {
      map.set(handle, success)
    } else if (handle === 'miss' || handle === 'fail') {
      map.set(handle, failure)
    } else if (handle === 'success') {
      map.set(handle, success)
    }
  }
  return map
}

/** Changes the type-specific fields while carrying shared timing and result settings to matching ports. */
export function retargetInteractionData(current: InteractionData, nextKind: StoryInteractionKind, createId: () => string): Record<string, unknown> {
  const nextSpec = readInteractionData({ ...defaultInteractionData(nextKind, createId), durationSec: current.durationSec })
  const mapping = retargetHandleMap(current.spec, nextSpec.spec)
  const results: Record<string, StoryResultConfig> = {}
  for (const [handle, target] of mapping) {
    if (target && !results[target]) results[target] = { ...current.results[handle], effects: [...(current.results[handle]?.effects ?? [])] }
  }
  return {
    ...defaultInteractionData(nextKind, createId),
    title: current.title === STORY_INTERACTION_LABEL[current.spec.type] ? STORY_INTERACTION_LABEL[nextKind] : current.title,
    startSec: current.startSec,
    durationSec: nextSpec.durationSec,
    during: current.during,
    hint: current.hint,
    results,
  }
}

export interface BeatWindow { startSec: number; durationSec: number }

export const beatWindowsOverlap = (a: BeatWindow, b: BeatWindow) =>
  a.startSec < b.startSec + b.durationSec && b.startSec < a.startSec + a.durationSec

/** Keeps a dragged window inside the video; an unknown length only clamps at zero. */
export function clampBeatStart(startSec: number, durationSec: number, videoDurationSec: number | null | undefined): number {
  const latest = videoDurationSec && videoDurationSec > 0 ? Math.max(0, videoDurationSec - durationSec) : STORY_BEAT_MAX_SEC
  return tenths(Math.min(latest, Math.max(0, startSec)))
}

export const defaultBeatDuration = (kind: StoryInteractionKind) => DEFAULT_DURATION[kind]

/** Earliest start where a window of this length clears the existing ones, kept inside the video when its length is known. */
export function firstFreeBeatStart(windows: readonly BeatWindow[], durationSec: number, videoDurationSec: number | null | undefined): number {
  let start = 0
  for (const window of [...windows].sort((a, b) => a.startSec - b.startSec)) {
    if (start + durationSec <= window.startSec) break
    start = Math.max(start, window.startSec + window.durationSec)
  }
  return clampBeatStart(start, durationSec, videoDurationSec)
}

/** The first mounted interaction that should be on screen at this video position and has not been used yet. */
export function dueBeat(beats: readonly StoryInteractionNode[], fired: ReadonlySet<string>, positionSec: number): StoryInteractionNode | null {
  return beats.find((beat) => !fired.has(beat.id) && positionSec >= beat.startSec) ?? null
}

export type TapJudgement = 'success' | 'pending'
export const judgeTap = (taps: number, count: number): TapJudgement => (taps >= count ? 'success' : 'pending')

/** Dominant axis of a pointer drag, or null while the drag is still too short. */
export function swipeDirectionOf(dx: number, dy: number, minDistance = 40): StorySwipeDirection | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < minDistance) return null
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
}

export type SwipeJudgement = 'success' | 'fail' | 'pending'
export function judgeSwipe(dx: number, dy: number, direction: StorySwipeDirection, minDistance = 40): SwipeJudgement {
  const swiped = swipeDirectionOf(dx, dy, minDistance)
  if (!swiped) return 'pending'
  return swiped === direction ? 'success' : 'fail'
}

/** Ping-pong pointer position in [0, 1]; `speed` is bar widths per second. */
export function timingPointer(elapsedSec: number, speed: number): number {
  const phase = ((Math.max(0, elapsedSec) * speed) % 2 + 2) % 2
  return phase <= 1 ? phase : 2 - phase
}

export type TimingJudgement = 'perfect' | 'normal' | 'miss'
/** The zones are centred on the bar; widths are percentages of the whole bar. */
export function judgeTiming(position: number, perfectWidth: number, normalWidth: number): TimingJudgement {
  const distance = Math.abs(position - 0.5) * 100
  if (distance <= perfectWidth / 2) return 'perfect'
  if (distance <= normalWidth / 2) return 'normal'
  return 'miss'
}

export function holdProgress(heldSec: number, fillSec: number, overchargeFails: boolean): { percent: number; overcharged: boolean } {
  const raw = (Math.max(0, heldSec) / fillSec) * 100
  return { percent: Math.min(100, raw), overcharged: overchargeFails && raw > 100 }
}

export type HoldJudgement = 'success' | 'fail'
export function judgeHold(heldSec: number, spec: Extract<StoryInteractionSpec, { type: 'hold' }>): HoldJudgement {
  const { percent, overcharged } = holdProgress(heldSec, spec.fillSec, spec.overchargeFails)
  if (overcharged) return 'fail'
  return percent >= spec.rangeMin && percent <= spec.rangeMax ? 'success' : 'fail'
}
