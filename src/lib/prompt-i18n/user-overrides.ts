import { prisma } from '@/lib/prisma'
import type { PromptId } from './prompt-ids'
import type { PromptLocale } from './types'

export type UserPromptOverrides = Record<string, Record<string, string>>

const overrideCache = new Map<string, { overrides: UserPromptOverrides; expires: number }>()
const CACHE_TTL_MS = 60_000

export async function loadUserPromptOverrides(userId: string): Promise<UserPromptOverrides> {
  const cached = overrideCache.get(userId)
  if (cached && cached.expires > Date.now()) {
    return cached.overrides
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customPromptTemplates: true },
  })

  const overrides = parseOverrides(pref?.customPromptTemplates)
  overrideCache.set(userId, { overrides, expires: Date.now() + CACHE_TTL_MS })
  return overrides
}

export function resolveUserTemplateOverride(
  overrides: UserPromptOverrides,
  promptId: PromptId,
  locale: PromptLocale,
): string | undefined {
  const entry = overrides[promptId]
  if (!entry) return undefined
  return entry[locale] || entry['zh'] || undefined
}

function parseOverrides(json: string | null | undefined): UserPromptOverrides {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as UserPromptOverrides
  } catch {
    return {}
  }
}

export function invalidateUserPromptCache(userId: string) {
  overrideCache.delete(userId)
}
