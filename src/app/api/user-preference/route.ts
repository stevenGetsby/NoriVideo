import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isArtStyleValue, isCustomArtStyleValue, parseCustomArtStyles } from '@/lib/constants'
import { normalizeImageGenerationCountPreferences } from '@/lib/image-generation/count'
import { normalizeSemverTag } from '@/lib/update-check'
import { normalizeVideoEnhanceSettings } from '@/lib/video-enhance/settings'

function validateArtStyleField(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ART_STYLE',
      field: 'artStyle',
      message: 'artStyle must be a supported value',
    })
  }
  const artStyle = value.trim()
  if (!isArtStyleValue(artStyle) && !isCustomArtStyleValue(artStyle)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ART_STYLE',
      field: 'artStyle',
      message: 'artStyle must be a supported value',
    })
  }
  return artStyle
}

function validateCustomArtStyles(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_CUSTOM_ART_STYLES',
      field: 'customArtStyles',
      message: 'customArtStyles must be a JSON string',
    })
  }
  // Validate it parses correctly
  parseCustomArtStyles(value)
  return value
}

function validateImageGenerationCounts(value: unknown): Prisma.InputJsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_IMAGE_GENERATION_COUNTS',
      field: 'imageGenerationCounts',
      message: 'imageGenerationCounts must be an object',
    })
  }
  return normalizeImageGenerationCountPreferences(value) as Prisma.InputJsonValue
}

function validateVideoEnhanceSettings(value: unknown): Prisma.InputJsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_VIDEO_ENHANCE_SETTINGS',
      field: 'videoEnhanceSettings',
      message: 'videoEnhanceSettings must be an object',
    })
  }
  return normalizeVideoEnhanceSettings(value) as unknown as Prisma.InputJsonValue
}

function validateMutedUpdateVersion(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_MUTED_UPDATE_VERSION',
      field: 'mutedUpdateVersion',
      message: 'mutedUpdateVersion must be a semver string or null',
    })
  }

  try {
    return normalizeSemverTag(value)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_MUTED_UPDATE_VERSION',
      field: 'mutedUpdateVersion',
      message: 'mutedUpdateVersion must be a semver string or null',
    })
  }
}

// GET - 获取用户偏好配置
export const GET = apiHandler(async () => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // 获取或创建用户偏好
  const preference = await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: {},
    create: { userId: session.user.id }
  })

  return NextResponse.json({ preference })
})

// PATCH - 更新用户偏好配置
export const PATCH = apiHandler(async (request: NextRequest) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()

  // 只允许更新特定字段
  const allowedFields = [
    'analysisModel',
    'characterModel',
    'locationModel',
    'storyboardModel',
    'editModel',
    'videoModel',
    'audioModel',
    'lipSyncModel',
    'videoRatio',
    'artStyle',
    'customArtStyles',
    'imageGenerationCounts',
    'videoEnhanceSettings',
    'mutedUpdateVersion',
    'ttsRate'
  ]

  const updateData: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === 'artStyle') {
        updateData[field] = validateArtStyleField(body[field])
        continue
      }
      if (field === 'customArtStyles') {
        updateData[field] = validateCustomArtStyles(body[field])
        continue
      }
      if (field === 'imageGenerationCounts') {
        updateData[field] = validateImageGenerationCounts(body[field])
        continue
      }
      if (field === 'videoEnhanceSettings') {
        updateData[field] = validateVideoEnhanceSettings(body[field])
        continue
      }
      if (field === 'mutedUpdateVersion') {
        updateData[field] = validateMutedUpdateVersion(body[field])
        continue
      }
      updateData[field] = body[field]
    }
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 更新或创建用户偏好
  const preference = await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: updateData,
    create: {
      userId: session.user.id,
      ...updateData
    }
  })

  return NextResponse.json({ preference })
})
