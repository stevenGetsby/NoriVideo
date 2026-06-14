/**
 * API Route: /api/super-agent/chat-edit
 * Agent 对已生成项目产物的可编辑修改入口。
 */

import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { applyAgentChatEdit } from '@/lib/super-agent/chat-edit'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import type { SkillId } from '@/lib/super-agent/types'
import { assertInternalAgentApiEnabled } from '@/lib/super-agent/internal-api-guard'

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readSkillId(value: string | null): SkillId | null {
  if (!value || !/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(value)) return null
  return value
}

export const POST = apiHandler(async (request: NextRequest) => {
  assertInternalAgentApiEnabled()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const payload = body as Record<string, unknown>
  const projectId = readString(payload.projectId)
  const episodeId = readString(payload.episodeId)
  const instruction = readString(payload.instruction)
  const executionMode = readString(payload.executionMode)
  const selectedSkill = readString(payload.selectedSkill)
  const locale = resolveTaskLocale(request, body) || 'zh'
  const referenceImageUrls = Array.isArray(payload.referenceImageUrls)
    ? payload.referenceImageUrls.map((item) => readString(item)).filter((item): item is string => Boolean(item))
    : []
  const allowVideoGeneration = payload.allowVideoGeneration === true

  if (!projectId || !episodeId || !instruction) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'AGENT_CHAT_EDIT_INVALID_PARAMS',
      message: 'projectId, episodeId and instruction are required',
    })
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const result = await applyAgentChatEdit({
      userId: authResult.session.user.id,
      projectId,
      episodeId,
      instruction,
      locale,
      mode: executionMode === 'mock' ? 'mock' : 'live',
      selectedSkill: readSkillId(selectedSkill),
      referenceImageUrls,
      allowVideoGeneration,
    })

    return Response.json({ result })
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'AGENT_CHAT_EDIT_FAILED',
        message: error.message,
      })
    }
    throw error
  }
})
