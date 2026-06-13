import type { CapabilityValue } from '@/lib/model-config-contract'

export type VideoDurationPanelInput = {
  duration?: number | null
  description?: string | null
  videoPrompt?: string | null
  firstLastFramePrompt?: string | null
  srtSegment?: string | null
  textSegment?: string | null
  shotType?: string | null
  cameraMove?: string | null
}

export type VideoGenerationOptionMap = Record<string, string | number | boolean>

const DEFAULT_MIN_SECONDS = 2
const DEFAULT_MAX_SECONDS = 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function countCjkChars(text: string): number {
  return (text.match(/[\u3400-\u9fff]/g) || []).length
}

function countLatinWords(text: string): number {
  return (text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length
}

function countSentences(text: string): number {
  return (text.match(/[。！？!?；;.!?]/g) || []).length
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern))
}

function shouldDisableGeneratedAudio(text: string): boolean {
  return /不要生成背景音乐|禁止生成背景音乐|不要背景音乐|无背景音乐|不生成背景音乐|no\s*(background\s*)?music|without\s*(background\s*)?music|no\s*bGM/i.test(text)
}

function estimateDialogueSeconds(text: string): number {
  const cjkChars = countCjkChars(text)
  const latinWords = countLatinWords(text)
  if (cjkChars === 0 && latinWords === 0) return 0
  return (cjkChars / 4.2) + (latinWords / 2.4)
}

function readExplicitDuration(panel: VideoDurationPanelInput): number | null {
  const value = panel.duration
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value > 1000 ? value / 1000 : value
}

function normalizeAllowedDurations(values: readonly CapabilityValue[] | undefined): number[] {
  if (!values) return []
  return values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
}

function pickNearestAllowedDuration(seconds: number, allowedDurations: number[]): number {
  if (allowedDurations.length === 0) return Math.round(clamp(seconds, DEFAULT_MIN_SECONDS, DEFAULT_MAX_SECONDS))
  return allowedDurations.reduce((best, candidate) => {
    const bestDelta = Math.abs(best - seconds)
    const candidateDelta = Math.abs(candidate - seconds)
    if (candidateDelta === bestDelta) return candidate > best ? candidate : best
    return candidateDelta < bestDelta ? candidate : best
  }, allowedDurations[0])
}

export function recommendVideoDurationSeconds(
  panel: VideoDurationPanelInput,
  allowedDurationValues?: readonly CapabilityValue[],
): number {
  const allowedDurations = normalizeAllowedDurations(allowedDurationValues)
  const minSeconds = allowedDurations[0] ?? DEFAULT_MIN_SECONDS
  const maxSeconds = allowedDurations[allowedDurations.length - 1] ?? DEFAULT_MAX_SECONDS
  const explicitDuration = readExplicitDuration(panel)

  if (explicitDuration !== null) {
    return pickNearestAllowedDuration(clamp(explicitDuration, minSeconds, maxSeconds), allowedDurations)
  }

  const dialogueText = normalizeText(panel.srtSegment || panel.textSegment)
  const visualText = [
    panel.videoPrompt,
    panel.firstLastFramePrompt,
    panel.description,
    panel.shotType,
    panel.cameraMove,
  ].map(normalizeText).filter(Boolean).join(' ')
  const combinedText = `${dialogueText} ${visualText}`

  let seconds = 3
  const dialogueSeconds = estimateDialogueSeconds(dialogueText)
  if (dialogueSeconds > 0) {
    seconds = Math.max(seconds, dialogueSeconds + 0.8)
  }

  const sentenceCount = countSentences(dialogueText || visualText)
  if (sentenceCount >= 2) seconds += 0.5
  if (sentenceCount >= 4) seconds += 0.75

  if (hasAny(combinedText, ['走', '跑', '散步', '穿过', '靠近', '离开', '转身', '跳', '飞', '掉进', '救', '伸出', '递给', '挥动', '落在', '照亮', '迷路'])) {
    seconds += 1
  }
  if (hasAny(combinedText, ['对话', '说', '谢谢', '别怕', '正在说话', 'narration', 'dialogue', 'speaking'])) {
    seconds += 0.75
  }
  if (hasAny(combinedText, ['建立', '全景', '远景', '环境', '森林', '街道', '房间', '夜晚', '开场'])) {
    seconds += 0.5
  }
  if (hasAny(combinedText, ['特写', '极端特写', 'close-up', '固定镜头'])) {
    seconds -= 0.5
  }
  if (hasAny(combinedText, ['转场', '过渡', '首尾帧', 'then transition'])) {
    seconds += 0.5
  }

  return pickNearestAllowedDuration(clamp(seconds, minSeconds, maxSeconds), allowedDurations)
}

export function withRecommendedVideoDurationOptions(
  panel: VideoDurationPanelInput,
  generationOptions: VideoGenerationOptionMap | undefined,
  allowedDurationValues?: readonly CapabilityValue[],
): VideoGenerationOptionMap {
  const combinedText = [
    panel.videoPrompt,
    panel.firstLastFramePrompt,
    panel.description,
    panel.srtSegment,
    panel.textSegment,
  ].map(normalizeText).filter(Boolean).join(' ')

  return {
    ...(generationOptions || {}),
    duration: recommendVideoDurationSeconds(panel, allowedDurationValues),
    ...(shouldDisableGeneratedAudio(combinedText) ? { generateAudio: false } : {}),
  }
}
