import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { PROMPT_CATALOG, getPromptTemplate, invalidateUserPromptCache } from '@/lib/prompt-i18n'
import type { PromptId } from '@/lib/prompt-i18n'

function parseOverrides(json: string | null | undefined): Record<string, Record<string, string>> {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, Record<string, string>>
  } catch {
    return {}
  }
}

// GET - 获取用户的自定义 prompt 模板列表 + 所有可用 prompt 的元数据
export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const pref = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { customPromptTemplates: true },
  })

  const overrides = parseOverrides(pref?.customPromptTemplates)

  // 提供所有可编辑的 prompt 的元数据
  const promptId = request.nextUrl.searchParams.get('promptId')
  const locale = (request.nextUrl.searchParams.get('locale') || 'zh') as 'zh' | 'en'

  if (promptId) {
    // 返回单个 prompt 的默认模板和用户覆盖
    const entry = PROMPT_CATALOG[promptId as PromptId]
    if (!entry) {
      throw new ApiError('NOT_FOUND')
    }
    const defaultTemplate = getPromptTemplate(promptId as PromptId, locale)
    const userTemplate = overrides[promptId]?.[locale] || null

    return NextResponse.json({
      promptId,
      locale,
      variableKeys: entry.variableKeys,
      defaultTemplate,
      userTemplate,
    })
  }

  // 返回所有 prompt 的概览
  const prompts = Object.entries(PROMPT_CATALOG).map(([id, entry]) => ({
    promptId: id,
    variableKeys: entry.variableKeys,
    hasOverride: {
      zh: !!overrides[id]?.zh,
      en: !!overrides[id]?.en,
    },
  }))

  return NextResponse.json({ prompts, overrides })
})

// PATCH - 更新单个 prompt 的自定义模板
export const PATCH = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const { promptId, locale, template } = body as {
    promptId?: string
    locale?: string
    template?: string | null
  }

  if (!promptId || !locale || (locale !== 'zh' && locale !== 'en')) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (!(promptId in PROMPT_CATALOG)) {
    throw new ApiError('INVALID_PARAMS', { message: 'Unknown promptId' })
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { customPromptTemplates: true },
  })

  const overrides = parseOverrides(pref?.customPromptTemplates)

  if (template !== undefined && template !== null && typeof template !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'template must be a string or null' })
  }

  if (template === null || template === '') {
    // 删除覆盖，恢复默认
    if (overrides[promptId]) {
      delete overrides[promptId][locale]
      if (Object.keys(overrides[promptId]).length === 0) {
        delete overrides[promptId]
      }
    }
  } else {
    if (!overrides[promptId]) overrides[promptId] = {}
    overrides[promptId][locale] = template ?? ''
  }

  await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: { customPromptTemplates: JSON.stringify(overrides) },
    create: { userId: session.user.id, customPromptTemplates: JSON.stringify(overrides) },
  })

  invalidateUserPromptCache(session.user.id)

  return NextResponse.json({ success: true })
})
