import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import {
  normalizeFrameosScriptStatus,
  toPrismaSections,
  toWriterScript,
} from '@/lib/frameos/screenwriter-script-service'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function actorId(session: { user: { id: string; actorId?: string } }): string {
  return session.user.actorId || session.user.id
}

const MAX_EPISODES = 200
const MAX_EPISODE_CHARS = 400_000
const MAX_TOTAL_EPISODE_CHARS = 2_000_000

async function ownedScript(scriptId: string, userId: string) {
  const script = await prisma.frameosScript.findFirst({ where: { id: scriptId, userId } })
  if (!script) throw new ApiError('NOT_FOUND', { message: '剧本不存在或不属于当前账号' })
  return script
}

export const GET = apiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { scriptId } = await params
  return NextResponse.json({
    success: true,
    script: toWriterScript(await ownedScript(scriptId, actorId(authResult.session))),
  })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { scriptId } = await params
  const current = await ownedScript(scriptId, actorId(authResult.session))
  const payload: unknown = await request.json().catch(() => null)
  if (!isRecord(payload)) throw new ApiError('INVALID_PARAMS', { message: '无法读取剧本更新内容' })

  const currentSections = isRecord(current.sections) ? current.sections : {}
  if (Array.isArray(payload.episodes) && payload.episodes.length > MAX_EPISODES) {
    throw new ApiError('INVALID_PARAMS', { message: `剧本不能超过 ${MAX_EPISODES} 集` })
  }
  const nextEpisodes = Array.isArray(payload.episodes)
    ? payload.episodes.flatMap((item, index) => {
      if (!isRecord(item)) return []
      return [{
        id: cleanText(item.id) || `${scriptId}-ep-${index + 1}`,
        title: cleanText(item.title).slice(0, 100) || `第 ${index + 1} 集`,
        body: typeof item.body === 'string' ? item.body.slice(0, MAX_EPISODE_CHARS) : '',
      }]
    })
    : undefined
  if (Array.isArray(payload.episodes) && !nextEpisodes?.length) {
    throw new ApiError('INVALID_PARAMS', { message: '剧本至少需要保留一集' })
  }
  if (nextEpisodes && nextEpisodes.reduce((total, episode) => total + episode.body.length, 0) > MAX_TOTAL_EPISODE_CHARS) {
    throw new ApiError('INVALID_PARAMS', { message: '剧本总内容过长，请拆分后重试' })
  }
  const nextTitle = payload.title === undefined ? current.title : cleanText(payload.title).slice(0, 200)
  if (!nextTitle) throw new ApiError('INVALID_PARAMS', { message: '剧本标题不能为空' })
  const updated = await prisma.frameosScript.update({
    where: { id: current.id },
    data: {
      title: nextTitle,
      status: payload.status === undefined ? current.status : normalizeFrameosScriptStatus(payload.status),
      ...(nextEpisodes ? {
        content: nextEpisodes.map((episode) => episode.body).join('\n\n'),
        sections: toPrismaSections({ ...currentSections, episodes: nextEpisodes }),
      } : {}),
    },
  })
  return NextResponse.json({ success: true, script: toWriterScript(updated) })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { scriptId } = await params
  const current = await ownedScript(scriptId, actorId(authResult.session))
  await prisma.frameosScript.delete({ where: { id: current.id } })
  return NextResponse.json({ success: true })
})
