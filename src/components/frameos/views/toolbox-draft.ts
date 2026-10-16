import type { FrameosMaterialItem } from '../materials/contracts'
import {
  isFrameosAssetCategory,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'

export type ToolboxDraftType = 'image' | 'video'

export interface ToolboxDraft {
  version: 1
  title: string
  prompt: string
  modelKey: string
  ratio: string
  resolution: string
  quality: 'low' | 'medium' | 'high'
  inputMode: 'text' | 'reference' | 'image' | 'firstlastframe'
  duration: number
  fps: number | null
  generateAudio: boolean
  assetCategory: FrameosAssetCategory
  references: FrameosMaterialItem[]
}

interface ToolboxDraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isReference(value: unknown): value is FrameosMaterialItem {
  const item = record(value)
  return typeof item.id === 'string'
    && item.id.length > 0
    && (item.type === 'image' || item.type === 'video' || item.type === 'audio' || item.type === 'model3d')
}

export function createToolboxDraftKey(
  accountId: string | null | undefined,
  projectId: string | null | undefined,
  type: ToolboxDraftType,
): string {
  const account = accountId?.trim() || ''
  const project = projectId?.trim() || ''
  return account && project
    ? `nori.toolbox.draft.v1:${account}:${project}:${type}`
    : ''
}

export function readToolboxDraft(
  storage: ToolboxDraftStorage,
  key: string,
): ToolboxDraft | null {
  if (!key) return null
  try {
    const source = record(JSON.parse(storage.getItem(key) || 'null'))
    if (source.version !== 1) return null
    const rawMode = source.inputMode
    const rawDuration = Number(source.duration)
    const duration = Number.isInteger(rawDuration) && rawDuration >= 4 && rawDuration <= 30
      ? rawDuration
      : 5
    const rawFps = Number(source.fps)
    const fps = Number.isInteger(rawFps) && rawFps >= 1 && rawFps <= 120 ? rawFps : null
    const references = Array.isArray(source.references)
      ? source.references.filter(isReference).slice(0, 15)
      : []
    // Older drafts labelled multimodal references as "text". Preserve those
    // inputs by reopening them as all-in-one reference, not pure text-to-video.
    const inputMode = rawMode === 'image' || rawMode === 'firstlastframe' || rawMode === 'reference'
      ? rawMode
      : references.length > 0 && source.inputModeVersion !== 2 ? 'reference' : 'text'
    return {
      version: 1,
      title: text(source.title),
      prompt: text(source.prompt),
      modelKey: text(source.modelKey),
      ratio: text(source.ratio) || '16:9',
      resolution: text(source.resolution),
      quality: source.quality === 'low' || source.quality === 'medium' ? source.quality : 'high',
      inputMode,
      duration,
      fps,
      generateAudio: source.generateAudio !== false,
      assetCategory: isFrameosAssetCategory(source.assetCategory) ? source.assetCategory : 'other',
      references,
    }
  } catch {
    return null
  }
}

export function writeToolboxDraft(
  storage: ToolboxDraftStorage,
  key: string,
  draft: ToolboxDraft,
): void {
  if (!key) return
  try {
    storage.setItem(key, JSON.stringify({ ...draft, inputModeVersion: 2 }))
  } catch {
    // Draft persistence must never block generation when storage is unavailable.
  }
}

export function resolveToolboxGenerateAudio(input: {
  type: ToolboxDraftType
  modelKey: string
  supportGenerateAudio: boolean
  draft: ToolboxDraft | null
}): boolean {
  if (input.type !== 'video' || !input.supportGenerateAudio) return false
  return input.draft?.modelKey === input.modelKey
    ? input.draft.generateAudio
    : true
}
