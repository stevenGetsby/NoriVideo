import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveRuntimeModelKey } from '@/lib/nori-model-catalog'
import {
  normalizeToOriginalMediaUrl,
  normalizeToPublicImageUrlForGeneration,
  normalizeReferenceImagesForGeneration,
} from './outbound-image'

/** Asset URIs are provider references, never TOS keys. Opt in only for Seedance. */
export function readSeedanceAssetUri(value: string, modelKey: string): string | null {
  const uri = value.trim()
  if (!/^asset:/i.test(uri)) return null
  const parsed = parseModelKeyStrict(resolveRuntimeModelKey(modelKey) || modelKey)
  const provider = parsed?.provider.split(':')[0].toLowerCase()
  if (!parsed || !['ark', 'kuaizi'].includes(provider || '') || !/doubao-seedance/i.test(parsed.modelId)) {
    throw new Error('SEEDANCE_ASSET_PROVIDER_UNSUPPORTED')
  }
  const valid = provider === 'kuaizi' ? /^asset:\/\/\d+$/ : /^asset:\/\/[a-zA-Z0-9_-]+$/
  if (!valid.test(uri)) throw new Error('SEEDANCE_ASSET_URI_INVALID')
  return uri
}

export async function normalizeSeedanceImageReference(value: string, modelKey: string): Promise<string> {
  return readSeedanceAssetUri(value, modelKey) || await normalizeToPublicImageUrlForGeneration(value)
}

export async function normalizeSeedanceMediaReference(value: string, modelKey: string): Promise<string> {
  const assetUri = readSeedanceAssetUri(value, modelKey)
  if (assetUri) return assetUri
  const normalized = await normalizeToOriginalMediaUrl(value)
  if (!/^https?:\/\//i.test(normalized)) throw new Error('SEEDANCE_MEDIA_URL_PUBLIC_REQUIRED')
  return normalized
}

export async function normalizeSeedanceImageReferences(values: string[], modelKey: string): Promise<string[]> {
  if (!values.some((value) => /^asset:/i.test(value.trim()))) {
    return await normalizeReferenceImagesForGeneration(values, { context: { modelKey } })
  }
  return await Promise.all(Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .map((value) => normalizeSeedanceImageReference(value, modelKey)))
}
