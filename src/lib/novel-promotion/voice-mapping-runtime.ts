import { executeAiTextStep } from '@/lib/ai-runtime'
import { safeParseJsonObject } from '@/lib/json-repair'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import type { Locale } from '@/i18n/routing'
import {
  buildCharacterVoiceMappingUpdates,
  type CharacterVoiceMappingPlan,
  type CharacterVoiceMappingTarget,
} from './voice-mapping-binding'

export type VoiceMappingCharacterLike = CharacterVoiceMappingTarget & {
  aliases?: string[] | string | null
  introduction?: string | null
  profileData?: string | null
  voiceId?: string | null
  voiceType?: string | null
  customVoiceUrl?: string | null
}

export type VoiceMappingVoiceLineLike = {
  id: string
  lineIndex: number
  speaker: string
  content: string
  emotionPrompt?: string | null
  emotionStrength?: number | null
  matchedPanelId?: string | null
}

export type VoiceMappingEpisodeLike = {
  id: string
  name?: string | null
  voiceLines?: VoiceMappingVoiceLineLike[]
}

export type VoiceMappingLibraryVoiceLike = {
  id: string
  name: string
  description?: string | null
  voiceId?: string | null
  voiceType?: string | null
  customVoiceUrl?: string | null
  voicePrompt?: string | null
  gender?: string | null
  language?: string | null
}

export type VoiceMappingInput = {
  characters: VoiceMappingCharacterLike[]
  episodes?: VoiceMappingEpisodeLike[]
  voiceLibrary?: VoiceMappingLibraryVoiceLike[]
  extraDialogueSamples?: Record<string, unknown>[]
  extraVoiceLibrary?: Record<string, unknown>[]
}

export type VoiceMappingPromptPayload = {
  characters_json: string
  dialogue_samples_json: string
  voice_library_json: string
}

export type VoiceMappingRunResult = {
  promptPayload: VoiceMappingPromptPayload
  mapping: Record<string, unknown>
  plan: CharacterVoiceMappingPlan
  text: string
  reasoning: string
}

type ExecuteTextStep = typeof executeAiTextStep

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  const text = readText(value)
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function parseAliases(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => readText(item)).filter(Boolean)
  const text = readText(value)
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.map((item) => readText(item)).filter(Boolean) : []
  } catch {
    return text.split('/').map((item) => item.trim()).filter(Boolean)
  }
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildCharacterAsset(character: VoiceMappingCharacterLike): Record<string, unknown> {
  const profile = parseJsonObject(character.profileData)
  return {
    character_id: character.id,
    name: character.name,
    aliases: parseAliases(character.aliases),
    introduction: character.introduction || '',
    role_type: profile.role_type || '',
    role_level: profile.role_level || '',
    gender: profile.gender || '',
    age_range: profile.age_range || '',
    description: profile.description || '',
    background: profile.background || '',
    representative_line: profile.representative_line || '',
    voice_trait: profile.voice_trait || '',
    voice_audition_prompt: profile.voice_audition_prompt || '',
    speech_rate: profile.speech_rate || 1,
    voice_id: profile.voice_id || character.voiceId || '',
    voice_raw_file: profile.voice_raw_file || character.customVoiceUrl || '',
    existing_voice_type: character.voiceType || '',
  }
}

function buildDialogueSamples(input: VoiceMappingInput): Record<string, unknown>[] {
  const samples = (input.episodes || []).flatMap((episode) =>
    (episode.voiceLines || []).map((line) => ({
      episode_id: episode.id,
      episode_name: episode.name || '',
      line_id: line.id,
      line_index: line.lineIndex,
      character: line.speaker,
      content: line.content,
      emotion_prompt: line.emotionPrompt || '',
      emotionStrength: line.emotionStrength ?? null,
      matched_panel_id: line.matchedPanelId || '',
    })),
  )
  return [...samples, ...(input.extraDialogueSamples || [])]
}

function buildVoiceLibrary(input: VoiceMappingInput): Record<string, unknown>[] {
  const voices = (input.voiceLibrary || []).map((voice) => ({
    library_id: voice.id,
    voice_id: voice.voiceId || '',
    voice_name: voice.name,
    voice_type: voice.voiceType || '',
    description: voice.description || '',
    voice_prompt: voice.voicePrompt || '',
    gender: voice.gender || '',
    language: voice.language || '',
    reference_audio_id: voice.customVoiceUrl || null,
  }))
  return [...voices, ...(input.extraVoiceLibrary || [])]
}

export function buildVoiceMappingPromptPayload(input: VoiceMappingInput): VoiceMappingPromptPayload {
  return {
    characters_json: compactJson({
      characters: input.characters.map(buildCharacterAsset),
    }),
    dialogue_samples_json: compactJson({
      samples: buildDialogueSamples(input),
    }),
    voice_library_json: compactJson({
      voices: buildVoiceLibrary(input),
    }),
  }
}

export function parseVoiceMappingResponse(responseText: string): Record<string, unknown> {
  return safeParseJsonObject(responseText)
}

export async function runVoiceMappingReview(params: {
  userId: string
  projectId: string
  model: string
  locale: Locale
  input: VoiceMappingInput
  executeTextStep?: ExecuteTextStep
}): Promise<VoiceMappingRunResult> {
  const promptPayload = buildVoiceMappingPromptPayload(params.input)
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_VOICE_MAPPING,
    locale: params.locale,
    variables: promptPayload,
  })
  const executeTextStep = params.executeTextStep || executeAiTextStep
  const completion = await executeTextStep({
    userId: params.userId,
    model: params.model,
    messages: [{ role: 'user', content: prompt }],
    projectId: params.projectId,
    action: 'voice_mapping',
    temperature: 0.2,
    maxTokens: 4096,
    meta: {
      stepId: 'voice_mapping',
      stepTitle: '角色音色匹配',
      stepIndex: 1,
      stepTotal: 1,
    },
  })
  const mapping = parseVoiceMappingResponse(completion.text)
  const plan = buildCharacterVoiceMappingUpdates({
    mappings: mapping,
    characters: params.input.characters.map((character) => ({
      id: character.id,
      name: character.name,
      aliases: character.aliases,
    })),
  })

  return {
    promptPayload,
    mapping,
    plan,
    text: completion.text,
    reasoning: completion.reasoning,
  }
}

