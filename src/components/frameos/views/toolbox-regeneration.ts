import type { FrameosMaterialItem, MaterialType } from '../materials/contracts'
import type { CanvasGenerationMaterialReference } from '@/lib/canvas/generation-reference-contract'
import {
  isFrameosAssetCategory,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'
import type { ToolboxInputMode } from './toolbox-draft'

export type ToolboxRegenerationType = 'image' | 'video'

export interface ToolboxRegenerationAsset {
  type: string
  modelId?: string | null
  params?: Record<string, unknown> | null
}

export interface ToolboxRegenerationDraft {
  title: string
  prompt: string
  modelKey: string
  ratio: string
  resolution: string
  quality: 'low' | 'medium' | 'high'
  inputMode: ToolboxInputMode
  duration: number
  fps: number | null
  generateAudio: boolean
  assetCategory: FrameosAssetCategory
  references: FrameosMaterialItem[]
}

export interface ToolboxSubmitState {
  submitting: boolean
  generationAllowed: boolean
  projectsLoading: boolean
  projectsError: string | null
  workId: string
  projectId: string
  modelKey: string
  configLoading: boolean
  modelAvailable?: boolean
}

const MATERIAL_TYPES = new Set<MaterialType>(['image', 'video', 'audio', 'model3d'])
const INPUT_MODES = new Set<ToolboxInputMode>(['text', 'reference', 'image', 'firstlastframe'])
const IMAGE_ASSET_CATEGORIES = new Set<FrameosAssetCategory>(['character', 'location', 'prop', 'other'])
const VIDEO_ASSET_CATEGORIES = new Set<FrameosAssetCategory>(['shot', 'other'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function materialType(value: unknown): MaterialType | null {
  const raw = text(value)
  return MATERIAL_TYPES.has(raw as MaterialType) ? raw as MaterialType : null
}

function clampInteger(value: unknown, min: number, max: number): number | null {
  const parsed = finiteNumber(value)
  if (parsed === null) return null
  const integer = Math.trunc(parsed)
  return integer >= min && integer <= max ? integer : null
}

function resolveAssetCategory(value: unknown, type: ToolboxRegenerationType): FrameosAssetCategory {
  if (!isFrameosAssetCategory(value)) return type === 'video' ? 'shot' : 'other'
  const allowed = type === 'image' ? IMAGE_ASSET_CATEGORIES : VIDEO_ASSET_CATEGORIES
  if (allowed.has(value)) return value
  return type === 'video' ? 'shot' : 'other'
}

function resolveInputMode(value: unknown, type: ToolboxRegenerationType): ToolboxInputMode {
  if (type === 'image') return 'text'
  const raw = text(value)
  return INPUT_MODES.has(raw as ToolboxInputMode) ? raw as ToolboxInputMode : 'reference'
}

/**
 * Rebuilds the ordered reference list from the immutable generation parameters.
 * The server always re-loads and re-authorizes the real material rows, so these
 * entries only need the identity, type and duration used by the form preview and
 * client-side validation. They intentionally carry no provider URLs.
 */
function referencesFromParams(params: Record<string, unknown>, type: ToolboxRegenerationType): FrameosMaterialItem[] {
  const summary = Array.isArray(params.referenceSummary) ? params.referenceSummary : []
  if (summary.length > 0) {
    return summary.flatMap((item, index) => {
      const source = record(item)
      const material = regenerationMaterial(source, index)
      return material ? [material] : []
    })
  }
  // Legacy image assets only ever reference images, so the fallback is safe.
  // Legacy video/assets without a summary cannot infer the media type and are
  // left for the user to re-select rather than guessing and sending bad input.
  if (type !== 'image') return []
  const legacy = Array.isArray(params.referenceMaterials) ? params.referenceMaterials : []
  return legacy.flatMap((item, index) => {
    const source = record(item)
    const material = regenerationMaterial({ type: 'image', title: `参考素材 ${index + 1}`, ...source }, index)
    return material ? [material] : []
  })
}

function regenerationMaterial(source: Record<string, unknown>, index: number): FrameosMaterialItem | null {
  const id = text(source.id) || text(source.materialId)
  const type = materialType(source.type)
  if (!id || !type) return null
  const duration = finiteNumber(source.durationSeconds)
  return {
    id,
    projectId: '',
    projectName: '',
    ownerName: null,
    title: text(source.title) || `参考素材 ${index + 1}`,
    type,
    source: 'toolbox',
    status: 'ready',
    isFavorited: false,
    resultUrl: null,
    storageKey: null,
    url: null,
    metadata: duration !== null && duration > 0 ? { durationSeconds: duration } : null,
    createdAt: '',
    updatedAt: '',
  }
}

/**
 * Builds a regeneration draft that is deliberately not an identity of the source
 * asset. It never restores idempotency keys, request hashes, canvas/node bindings
 * or project ownership: a submit always creates a brand new toolbox asset under
 * the project/work currently selected by the user.
 */
export function buildToolboxRegenerationDraft(
  asset: ToolboxRegenerationAsset,
  type: ToolboxRegenerationType,
): ToolboxRegenerationDraft | null {
  if (asset.type !== type) return null
  const params = record(asset.params)
  const duration = clampInteger(params.duration, 4, 30)
  const fps = clampInteger(params.fps, 1, 120)
  const quality = params.quality === 'low' || params.quality === 'medium' || params.quality === 'high'
    ? params.quality
    : 'high'
  return {
    title: text(params.title),
    prompt: text(params.prompt),
    modelKey: text(params.modelKey) || text(asset.modelId),
    ratio: text(params.aspectRatio) || '16:9',
    resolution: text(params.resolution),
    quality,
    inputMode: resolveInputMode(params.inputMode, type),
    duration: duration ?? 5,
    fps,
    generateAudio: params.generateAudio !== false,
    assetCategory: resolveAssetCategory(params.assetCategory, type),
    references: referencesFromParams(params, type),
  }
}

/**
 * Maps a historical model identifier (which may be a resolved runtime key) back
 * to a model the current account can generate with. Exact matches win; otherwise
 * fall back to the stable `provider::model` suffix.
 */
export function resolveToolboxRegenerationModelKey(input: {
  requestedModelKey: string
  modelId?: string | null
  availableModelKeys: readonly string[]
}): string {
  const candidates = [text(input.requestedModelKey), text(input.modelId)].filter(Boolean)
  for (const candidate of candidates) {
    if (input.availableModelKeys.includes(candidate)) return candidate
    const suffix = candidate.split('::').pop()
    if (!suffix) continue
    const matched = input.availableModelKeys.find((key) => key.split('::').pop() === suffix)
    if (matched) return matched
  }
  return ''
}

export interface ToolboxGenerationRequestInput {
  workId: string
  projectId: string
  type: ToolboxRegenerationType
  title: string
  prompt: string
  modelKey: string
  assetCategory: FrameosAssetCategory
  referenceMaterialIds: readonly string[]
  referenceMaterials: readonly CanvasGenerationMaterialReference[]
  inputMode: string
  textOnly: boolean
  options: Readonly<Record<string, string | number | boolean>>
}

export interface ToolboxGenerationRequestBody extends Omit<ToolboxGenerationRequestInput, 'referenceMaterialIds' | 'referenceMaterials' | 'options'> {
  referenceMaterialIds: string[]
  referenceMaterials: CanvasGenerationMaterialReference[]
  options: Record<string, string | number | boolean>
  idempotencyKey: string
}

function newIdempotencyKey(): string {
  const key = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : ''
  if (!key) throw new Error('无法创建本次生成的幂等键，请刷新页面后重试。')
  return key
}

/**
 * Builds the toolbox submission body from the current editor state. The body is
 * a whitelist: it never carries the selected history asset id, its original
 * idempotency key, request hash, or canvas/node binding. Project and work
 * ownership always come from the user's current selection. Every call mints a
 * new idempotency key, so editing the title or prompt and pressing generate
 * creates a brand-new toolbox record and material while the source asset stays
 * untouched.
 */
export function buildToolboxGenerationRequestBody(
  input: ToolboxGenerationRequestInput,
  createIdempotencyKey: () => string = newIdempotencyKey,
): ToolboxGenerationRequestBody {
  const idempotencyKey = createIdempotencyKey().trim()
  if (!idempotencyKey) throw new Error('本次生成的幂等键无效，请刷新页面后重试。')
  return {
    workId: input.workId,
    projectId: input.projectId,
    type: input.type,
    title: input.title.trim(),
    prompt: input.prompt.trim(),
    modelKey: input.modelKey,
    assetCategory: input.assetCategory,
    referenceMaterialIds: [...input.referenceMaterialIds],
    referenceMaterials: input.referenceMaterials.map((reference) => ({ ...reference })),
    inputMode: input.inputMode,
    textOnly: input.textOnly,
    idempotencyKey,
    options: { ...input.options },
  }
}

/**
 * Single source of truth for the generate button. Combined with the component's
 * synchronous submit lock, it prevents repeated clicks from enqueueing a second
 * chargeable task while the first request is still in flight.
 */
export function isToolboxGenerationSubmitDisabled(input: ToolboxSubmitState): boolean {
  return input.submitting
    || !input.generationAllowed
    || input.projectsLoading
    || Boolean(input.projectsError)
    || !input.workId
    || !input.projectId
    || !input.modelKey
    || input.configLoading
    || input.modelAvailable === false
}
