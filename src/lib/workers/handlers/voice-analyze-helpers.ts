import { safeParseJson, safeParseJsonArray } from '@/lib/json-repair'
import {
  readActingNotesContinuityText,
  readPanelFrameOSMetadataFromActingNotes,
} from '@/lib/novel-promotion/panel-frameos-metadata'

export interface StoryboardPanelLike {
  id?: string | null
  panelIndex: number
  panelNumber?: number | null
  shotType?: string | null
  cameraMove?: string | null
  srtSegment: string | null
  description: string | null
  characters: string | null
  location?: string | null
  props?: string | null
  duration?: number | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  photographyRules?: string | null
  actingNotes?: string | null
  sceneType?: string | null
}

export interface StoryboardLike {
  id: string
  panels: StoryboardPanelLike[]
}

export interface VoiceLineMatchedPanel {
  storyboardId?: string
  panelIndex?: number
}

export interface VoiceLinePayload {
  lineIndex?: number
  speaker?: string
  content?: string
  emotionStrength?: number
  matchedPanel?: VoiceLineMatchedPanel | null
}

function parseVoiceLinePayload(value: unknown): VoiceLinePayload | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const matchedPanelRaw =
    record.matchedPanel && typeof record.matchedPanel === 'object'
      ? (record.matchedPanel as Record<string, unknown>)
      : null
  return {
    lineIndex: typeof record.lineIndex === 'number' ? record.lineIndex : undefined,
    speaker: typeof record.speaker === 'string' ? record.speaker : undefined,
    content: typeof record.content === 'string' ? record.content : undefined,
    emotionStrength: typeof record.emotionStrength === 'number' ? record.emotionStrength : undefined,
    matchedPanel: matchedPanelRaw
      ? {
        storyboardId: typeof matchedPanelRaw.storyboardId === 'string' ? matchedPanelRaw.storyboardId : undefined,
        panelIndex: typeof matchedPanelRaw.panelIndex === 'number' ? matchedPanelRaw.panelIndex : undefined,
      }
      : null,
  }
}

function readName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' && record.name.trim() ? record.name.trim() : null
}

function parseNameList(raw: string | null | undefined): string[] {
  if (!raw) return []
  const text = raw.trim()
  if (!text) return []

  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => readName(item)).filter((item): item is string => Boolean(item))
    }
    const name = readName(parsed)
    return name ? [name] : []
  } catch {
    return [text]
  }
}

function buildContinuityNotes(panel: StoryboardPanelLike): string {
  const metadata = readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)
  return [metadata?.continuity_notes, panel.photographyRules, readActingNotesContinuityText(panel.actingNotes)]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('\n')
}

export function buildStoryboardJson(storyboards: StoryboardLike[]): string {
  const panelsData: Array<{
    storyboardId: string
    panelIndex: number
    panel_id: string
    panel_number: number
    text_segment: string
    source_text: string
    source_anchor: unknown
    description: string
    characters: string[]
    location: string
    props: string[]
    referenced_assets: unknown
    scene_type: string
    shot_type: string
    camera_move: string
    image_prompt: string
    visual_prompt: string
    video_prompt: string
    visual_style: string
    visual_style_description: string
    continuity_notes: string
    voice_refs: unknown
    duration: number | null
  }> = []

  for (const sb of storyboards) {
    const panels = sb.panels || []
    for (const panel of panels) {
      const textSegment = panel.srtSegment || ''
      const characters = parseNameList(panel.characters)
      const props = parseNameList(panel.props)
      const location = panel.location || ''
      const metadata = readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)
      const sourceText = typeof metadata?.source_text === 'string' && metadata.source_text.trim()
        ? metadata.source_text
        : textSegment
      panelsData.push({
        storyboardId: sb.id,
        panelIndex: panel.panelIndex,
        panel_id: metadata?.panel_id || panel.id || `${sb.id}:${panel.panelIndex}`,
        panel_number: typeof metadata?.panel_number === 'number'
          ? metadata.panel_number
          : typeof panel.panelNumber === 'number'
            ? panel.panelNumber
            : panel.panelIndex + 1,
        text_segment: textSegment,
        source_text: sourceText,
        source_anchor: metadata?.source_anchor ?? (sourceText ? { text: sourceText } : null),
        description: panel.description || '',
        characters,
        location,
        props,
        referenced_assets: metadata?.referenced_assets ?? {
          characters,
          location,
          props,
        },
        scene_type: panel.sceneType || '',
        shot_type: panel.shotType || '',
        camera_move: panel.cameraMove || '',
        image_prompt: panel.imagePrompt || '',
        visual_prompt: metadata?.visual_prompt || panel.imagePrompt || '',
        video_prompt: panel.videoPrompt || '',
        visual_style: metadata?.visual_style || '',
        visual_style_description: metadata?.visual_style_description || '',
        continuity_notes: buildContinuityNotes(panel),
        voice_refs: metadata?.voice_refs || [],
        duration: typeof panel.duration === 'number' ? panel.duration : null,
      })
    }
  }

  if (panelsData.length === 0) {
    return '无分镜数据'
  }

  return JSON.stringify(panelsData, null, 2)
}

export function parseVoiceLinesJson(responseText: string): VoiceLinePayload[] {
  const parsed = safeParseJsonArray(responseText)
  if (parsed.length === 0) {
    const raw = safeParseJson(responseText)
    if (Array.isArray(raw) && raw.length === 0) {
      return []
    }
    throw new Error('Invalid voice lines data structure')
  }
  const voiceLines = parsed
    .map((item) => parseVoiceLinePayload(item))
    .filter((item): item is VoiceLinePayload => Boolean(item))
  if (voiceLines.length === 0) {
    throw new Error('Invalid voice lines data structure')
  }
  return voiceLines
}
