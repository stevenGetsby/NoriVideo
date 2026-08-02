import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import {
  buildVideoRepaintSections,
  listFrameosScriptsForAccount,
  toPrismaSections,
  toWriterScript,
} from '@/lib/frameos/screenwriter-script-service'

const MAX_SCRIPT_CHARS = 400_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function actorId(session: { user: { id: string; actorId?: string } }): string {
  return session.user.actorId || session.user.id
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
  const targetScript = cleanText(payload.targetScript)
  const sourceScript = cleanText(payload.sourceScript)
  if (!title || !targetScript || !sourceScript) {
    throw new ApiError('INVALID_PARAMS', { message: '任务名称、源剧本和转绘剧本不能为空' })
  }
  if (targetScript.length > MAX_SCRIPT_CHARS || sourceScript.length > MAX_SCRIPT_CHARS) {
    throw new ApiError('INVALID_PARAMS', { message: '剧本内容过长，请拆分后重试' })
  }
  const resultMode = payload.resultMode === 'source_copy' ? 'source_copy' : 'llm'
  const id = randomUUID()
  const sourceAnalysis = isRecord(payload.sourceAnalysis) ? payload.sourceAnalysis : null
  const sections = buildVideoRepaintSections({
    scriptId: id,
    targetScript,
    sourceScript,
    sourceStoryboard: cleanText(payload.sourceStoryboard),
    adaptationBrief: cleanText(payload.adaptationBrief).slice(0, 2_000),
    adaptationContract: sourceAnalysis?.adaptation_contract,
    resultMode,
    model: cleanText(payload.model).slice(0, 200),
    sourceFileName: cleanText(payload.sourceFileName).slice(0, 240),
    episodeTitle: cleanText(payload.episodeTitle).slice(0, 100),
  })
  const created = await prisma.frameosScript.create({
    data: {
      id,
      userId: actorId(authResult.session),
      projectId: id,
      title,
      content: targetScript,
      status: 'draft',
      sections: toPrismaSections(sections),
    },
  })
  return NextResponse.json({ success: true, script: toWriterScript(created) }, { status: 201 })
})
