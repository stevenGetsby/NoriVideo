import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import {
  buildVideoRepaintSections,
  joinDocumentBodies,
  listFrameosScriptsForAccount,
  toPrismaSections,
  toWriterScript,
} from '@/lib/frameos/screenwriter-script-service'

const MAX_DOCUMENT_CHARS = 400_000
const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024
const MAX_CLIENT_REQUEST_ID_CHARS = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function actorId(session: { user: { id: string; actorId?: string } }): string {
  return session.user.actorId || session.user.id
}

/** A retried save (double click, network timeout, refresh) must not create a
 * second draft. The client supplies a stable request id and the resulting row
 * id is derived from the account + request id. */
function stableScriptId(userId: string, clientRequestId: string): string {
  const digest = createHash('sha256')
    .update(`video-repaint-save:${userId}:${clientRequestId}`)
    .digest('hex')
    .slice(0, 32)
  return `vr_${digest}`
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const scripts = await listFrameosScriptsForAccount(actorId(authResult.session))
  return NextResponse.json({ success: true, scripts })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const payload: unknown = await request.json().catch(() => null)
  if (!isRecord(payload)) throw new ApiError('INVALID_PARAMS', { message: '无法读取剧本内容' })

  const title = cleanText(payload.title).slice(0, 200)
  const outline = cleanText(payload.outline)
  const targetScript = cleanText(payload.targetScript)
  const storyboard = cleanText(payload.storyboard)
  const sourceScript = cleanText(payload.sourceScript)
  if (!title) {
    throw new ApiError('INVALID_PARAMS', { message: '任务名称不能为空' })
  }
  if (!outline && !targetScript && !storyboard) {
    throw new ApiError('INVALID_PARAMS', { message: '目标剧本、目标设定总纲和分镜都是空的，没有可保存的内容' })
  }
  if ([outline, targetScript, storyboard, sourceScript].some((text) => text.length > MAX_DOCUMENT_CHARS)) {
    throw new ApiError('INVALID_PARAMS', { message: '文档内容过长，请拆分后重试' })
  }
  const ownerId = actorId(authResult.session)
  const clientRequestId = cleanText(payload.clientRequestId)
  if (clientRequestId.length > MAX_CLIENT_REQUEST_ID_CHARS) {
    throw new ApiError('INVALID_PARAMS', { message: '保存请求标识过长' })
  }
  const id = clientRequestId ? stableScriptId(ownerId, clientRequestId) : randomUUID()
  const sourceAnalysis = isRecord(payload.sourceAnalysis) ? payload.sourceAnalysis : null
  if (sourceAnalysis) {
    try {
      if (JSON.stringify(sourceAnalysis).length > MAX_ANALYSIS_BYTES) {
        throw new ApiError('INVALID_PARAMS', { message: '源剧本分析数据过大' })
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('INVALID_PARAMS', { message: '源剧本分析数据无法序列化' })
    }
  }

  const existing = await prisma.frameosScript.findUnique({ where: { id } })
  if (existing) {
    if (existing.userId !== ownerId) {
      throw new ApiError('CONFLICT', { message: '保存请求标识冲突，请重试' })
    }
    return NextResponse.json({ success: true, script: toWriterScript(existing), idempotent: true })
  }

  const sections = buildVideoRepaintSections({
    scriptId: id,
    outline,
    targetScript,
    storyboard,
    sourceScript,
    adaptationBrief: cleanText(payload.adaptationBrief).slice(0, 2_000),
    adaptationContract: sourceAnalysis?.adaptation_contract,
    model: cleanText(payload.model).slice(0, 200),
    sourceFileName: cleanText(payload.sourceFileName).slice(0, 240),
  })
  try {
    const created = await prisma.frameosScript.create({
      data: {
        id,
        userId: ownerId,
        projectId: id,
        title,
        content: joinDocumentBodies(sections.episodes),
        status: 'draft',
        sections: toPrismaSections(sections),
      },
    })
    return NextResponse.json({ success: true, script: toWriterScript(created) }, { status: 201 })
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const concurrent = await prisma.frameosScript.findUnique({ where: { id } })
    if (!concurrent || concurrent.userId !== ownerId) {
      throw new ApiError('CONFLICT', { message: '保存请求冲突，请重试' })
    }
    return NextResponse.json({ success: true, script: toWriterScript(concurrent), idempotent: true })
  }
})
