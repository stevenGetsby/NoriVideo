import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getUserModelConfig } from '@/lib/config-service'
import { logError } from '@/lib/logging/core'
import {
  PROJECT_STYLE_REFERENCE_FIELD,
  PROJECT_STYLE_REFERENCE_MAX_COUNT,
  projectStyleReferenceKind,
} from '@/lib/projects/style-reference-contract'
import { prepareProjectStyleReferences } from '@/lib/projects/style-reference-upload'
import {
  analyzeProjectStyleReferenceImages,
  PROJECT_STYLE_ANALYSIS_MAX_IMAGE_BYTES,
} from '@/lib/projects/style-reference-analysis'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const form = await request.formData()
  const files = form
    .getAll(PROJECT_STYLE_REFERENCE_FIELD)
    .filter((value): value is File => value instanceof File)
  if (files.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STYLE_REFERENCE_IMAGE_REQUIRED',
      field: PROJECT_STYLE_REFERENCE_FIELD,
      message: '请先上传至少一张画风参考图片。',
    })
  }
  if (files.length > PROJECT_STYLE_REFERENCE_MAX_COUNT) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STYLE_REFERENCE_COUNT_EXCEEDED',
      field: PROJECT_STYLE_REFERENCE_FIELD,
      message: `画风参考最多解析 ${PROJECT_STYLE_REFERENCE_MAX_COUNT} 张图片。`,
    })
  }
  for (const [index, file] of files.entries()) {
    if (projectStyleReferenceKind(file) !== 'image') {
      throw new ApiError('INVALID_PARAMS', {
        code: 'STYLE_REFERENCE_ANALYSIS_IMAGE_ONLY',
        field: PROJECT_STYLE_REFERENCE_FIELD,
        styleReferenceIndex: index,
        message: '画风解析当前仅支持 JPG 或 PNG 图片；视频仍可作为项目参考素材保存。',
      })
    }
    if (file.size > PROJECT_STYLE_ANALYSIS_MAX_IMAGE_BYTES) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'STYLE_REFERENCE_ANALYSIS_IMAGE_TOO_LARGE',
        field: PROJECT_STYLE_REFERENCE_FIELD,
        styleReferenceIndex: index,
        message: '用于画风解析的单张图片不能超过 20MB。',
      })
    }
  }

  const references = await prepareProjectStyleReferences(form)
  const models = await getUserModelConfig(authResult.session.user.id)
  if (!models.analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ANALYSIS_MODEL_NOT_CONFIGURED',
      message: '请先在模型配置中选择支持图片理解的分析模型。',
    })
  }

  try {
    const prompt = await analyzeProjectStyleReferenceImages({
      userId: authResult.session.user.id,
      modelKey: models.analysisModel,
      references,
    })
    return NextResponse.json({ prompt })
  } catch (error) {
    logError('[Project Style Analysis] 画风参考解析失败', error)
    throw new ApiError('INTERNAL_ERROR', {
      code: 'STYLE_REFERENCE_ANALYSIS_FAILED',
      message: '画风解析失败。请确认分析模型支持图片理解并检查服务配置后重试。',
    })
  }
})
