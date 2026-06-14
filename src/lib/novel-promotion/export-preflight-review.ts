import { executeAiTextStep } from '@/lib/ai-runtime'
import { safeParseJsonObject } from '@/lib/json-repair'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import type { Locale } from '@/i18n/routing'
import { readPanelFrameOSMetadataFromActingNotes } from './panel-frameos-metadata'

export type ExportPreflightPanelLike = {
  id: string
  panelIndex?: number | null
  panelNumber?: number | null
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  location?: string | null
  characters?: string | null
  props?: string | null
  duration?: number | null
  imagePrompt?: string | null
  imageUrl?: string | null
  videoPrompt?: string | null
  videoUrl?: string | null
  lipSyncVideoUrl?: string | null
  srtSegment?: string | null
  actingNotes?: string | null
}

export type ExportPreflightStoryboardLike = {
  id: string
  clipId?: string | null
  clip?: {
    id?: string | null
    summary?: string | null
    content?: string | null
    location?: string | null
    characters?: string | null
    props?: string | null
    screenplay?: string | null
  } | null
  panels?: ExportPreflightPanelLike[]
}

export type ExportPreflightVoiceLineLike = {
  id: string
  lineIndex: number
  speaker: string
  content: string
  audioUrl?: string | null
  matchedPanelId?: string | null
  matchedStoryboardId?: string | null
  matchedPanelIndex?: number | null
  emotionPrompt?: string | null
  emotionStrength?: number | null
}

export type ExportPreflightEpisodeLike = {
  id: string
  episodeNumber?: number | null
  name?: string | null
  description?: string | null
  novelText?: string | null
  speakerVoices?: string | null
  storyboards?: ExportPreflightStoryboardLike[]
  voiceLines?: ExportPreflightVoiceLineLike[]
}

export type ExportPreflightCharacterLike = {
  id: string
  name: string
  aliases?: string | null
  introduction?: string | null
  profileData?: string | null
  profileConfirmed?: boolean | null
  voiceId?: string | null
  voiceType?: string | null
  customVoiceUrl?: string | null
}

export type ExportPreflightLocationLike = {
  id: string
  name: string
  summary?: string | null
  assetKind?: string | null
  selectedImageId?: string | null
  images?: Array<{
    id: string
    description?: string | null
    availableSlots?: string | null
    imageUrl?: string | null
    isSelected?: boolean | null
  }>
}

export type ExportPreflightInput = {
  exportTarget: string
  episodes: ExportPreflightEpisodeLike[]
  characters?: ExportPreflightCharacterLike[]
  locations?: ExportPreflightLocationLike[]
  extraAssets?: Record<string, unknown>
  extraVoice?: Record<string, unknown>
}

export type ExportPreflightPromptPayload = {
  export_target: string
  episodes_json: string
  assets_json: string
  storyboard_json: string
  voice_json: string
}

export type ExportPreflightReviewResult = Record<string, unknown>

type ExecuteTextStep = typeof executeAiTextStep

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonValue(value: string | null | undefined): unknown {
  const text = readText(value)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function pruneEmpty(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => pruneEmpty(item)).filter((item) => item !== undefined)
  }
  if (!value || typeof value !== 'object') {
    if (value === '') return undefined
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const next = pruneEmpty(item)
    if (next !== undefined && next !== null) {
      result[key] = next
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function compactJson(value: unknown): string {
  return JSON.stringify(pruneEmpty(value) ?? {}, null, 2)
}

function readNameList(raw: string | null | undefined): unknown {
  return parseJsonValue(raw) || []
}

function buildPanelRecord(storyboard: ExportPreflightStoryboardLike, panel: ExportPreflightPanelLike) {
  const metadata = readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)
  return {
    panel_id: metadata?.panel_id || panel.id,
    storyboard_id: storyboard.id,
    clip_id: storyboard.clipId || storyboard.clip?.id || '',
    panel_index: panel.panelIndex,
    panel_number: metadata?.panel_number ?? panel.panelNumber,
    description: panel.description,
    source_text: metadata?.source_text || panel.srtSegment,
    source_anchor: metadata?.source_anchor,
    referenced_assets: metadata?.referenced_assets || {
      characters: readNameList(panel.characters),
      location: panel.location,
      props: readNameList(panel.props),
    },
    characters: readNameList(panel.characters),
    location: panel.location,
    props: readNameList(panel.props),
    shot_type: panel.shotType,
    camera_move: panel.cameraMove,
    image_prompt: panel.imagePrompt,
    visual_prompt: metadata?.visual_prompt || panel.imagePrompt,
    video_prompt: panel.videoPrompt,
    visual_style: metadata?.visual_style,
    visual_style_description: metadata?.visual_style_description,
    continuity_notes: metadata?.continuity_notes,
    voice_refs: metadata?.voice_refs,
    duration: panel.duration,
    image_url: panel.imageUrl,
    video_url: panel.videoUrl,
    lip_sync_video_url: panel.lipSyncVideoUrl,
  }
}

export function buildExportPreflightPromptPayload(input: ExportPreflightInput): ExportPreflightPromptPayload {
  const episodes = input.episodes.map((episode) => ({
    episode_id: episode.id,
    episode_number: episode.episodeNumber,
    title: episode.name,
    summary: episode.description,
    source_text_present: Boolean(readText(episode.novelText)),
    speaker_voices: parseJsonValue(episode.speakerVoices),
    clips: (episode.storyboards || []).map((storyboard) => ({
      storyboard_id: storyboard.id,
      clip_id: storyboard.clipId || storyboard.clip?.id || '',
      summary: storyboard.clip?.summary,
      source_text: storyboard.clip?.content,
      location: storyboard.clip?.location,
      characters: parseJsonValue(storyboard.clip?.characters || null),
      props: parseJsonValue(storyboard.clip?.props || null),
      screenplay: parseJsonValue(storyboard.clip?.screenplay || null),
    })),
  }))

  const storyboardPanels = input.episodes.flatMap((episode) =>
    (episode.storyboards || []).flatMap((storyboard) =>
      (storyboard.panels || []).map((panel) => ({
        episode_id: episode.id,
        ...buildPanelRecord(storyboard, panel),
      })),
    ),
  )

  const assets = {
    characters: (input.characters || []).map((character) => ({
      character_id: character.id,
      name: character.name,
      aliases: parseJsonValue(character.aliases),
      introduction: character.introduction,
      profile: parseJsonValue(character.profileData),
      profile_confirmed: character.profileConfirmed,
      voice_id: character.voiceId,
      voice_type: character.voiceType,
      custom_voice_url: character.customVoiceUrl,
    })),
    environments: (input.locations || [])
      .filter((location) => location.assetKind !== 'prop')
      .map((location) => ({
        asset_id: location.id,
        name: location.name,
        summary: location.summary,
        selected_image_id: location.selectedImageId,
        images: (location.images || []).map((image) => ({
          image_id: image.id,
          description: image.description,
          available_slots: parseJsonValue(image.availableSlots),
          image_url: image.imageUrl,
          is_selected: image.isSelected,
        })),
      })),
    items: (input.locations || [])
      .filter((location) => location.assetKind === 'prop')
      .map((location) => ({
        asset_id: location.id,
        name: location.name,
        summary: location.summary,
        selected_image_id: location.selectedImageId,
        images: (location.images || []).map((image) => ({
          image_id: image.id,
          description: image.description,
          available_slots: parseJsonValue(image.availableSlots),
          image_url: image.imageUrl,
          is_selected: image.isSelected,
        })),
      })),
    ...(input.extraAssets || {}),
  }

  const voice = {
    lines: input.episodes.flatMap((episode) =>
      (episode.voiceLines || []).map((line) => ({
        episode_id: episode.id,
        line_id: line.id,
        line_index: line.lineIndex,
        speaker: line.speaker,
        content: line.content,
        audio_url: line.audioUrl,
        matched_panel_id: line.matchedPanelId,
        matched_storyboard_id: line.matchedStoryboardId,
        matched_panel_index: line.matchedPanelIndex,
        emotion_prompt: line.emotionPrompt,
        emotion_strength: line.emotionStrength,
        status: line.audioUrl ? 'generated' : 'pending',
      })),
    ),
    speaker_voices: input.episodes.map((episode) => ({
      episode_id: episode.id,
      speaker_voices: parseJsonValue(episode.speakerVoices),
    })),
    ...(input.extraVoice || {}),
  }

  return {
    export_target: input.exportTarget,
    episodes_json: compactJson({ episodes }),
    assets_json: compactJson(assets),
    storyboard_json: compactJson({ panels: storyboardPanels }),
    voice_json: compactJson(voice),
  }
}

export function parseExportPreflightReview(responseText: string): ExportPreflightReviewResult {
  return safeParseJsonObject(responseText)
}

export async function runExportPreflightReview(params: {
  userId: string
  projectId: string
  model: string
  locale: Locale
  input: ExportPreflightInput
  executeTextStep?: ExecuteTextStep
}): Promise<{
  promptPayload: ExportPreflightPromptPayload
  review: ExportPreflightReviewResult
  text: string
  reasoning: string
}> {
  const promptPayload = buildExportPreflightPromptPayload(params.input)
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_EXPORT_PREFLIGHT_REVIEW,
    locale: params.locale,
    variables: promptPayload,
  })
  const executeTextStep = params.executeTextStep || executeAiTextStep
  const completion = await executeTextStep({
    userId: params.userId,
    model: params.model,
    messages: [{ role: 'user', content: prompt }],
    projectId: params.projectId,
    action: 'export_preflight_review',
    temperature: 0.2,
    maxTokens: 4096,
    meta: {
      stepId: 'export_preflight_review',
      stepTitle: '导出前质检',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  return {
    promptPayload,
    review: parseExportPreflightReview(completion.text),
    text: completion.text,
    reasoning: completion.reasoning,
  }
}

