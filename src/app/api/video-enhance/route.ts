import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { getSignedObjectUrl } from '@/lib/storage'
import { serializeVideoEnhanceTask } from '@/lib/video-enhance/history'

const RESULT_SIGNED_URL_EXPIRES_SECONDS = 7 * 24 * 60 * 60

export const GET = apiHandler(async (request: NextRequest) => {  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') || '100', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100

  const tasks = await prisma.videoEnhanceTask.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const serializedTasks = await Promise.all(tasks.map(async (task) => {
    let resultVideoUrl = task.resultVideoUrl
    if (task.resultStorageKey) {
      try {
        resultVideoUrl = await getSignedObjectUrl(task.resultStorageKey, RESULT_SIGNED_URL_EXPIRES_SECONDS)
      } catch {
        resultVideoUrl = task.resultVideoUrl
      }
    }
    return serializeVideoEnhanceTask(task, resultVideoUrl)
  }))

  return NextResponse.json({
    success: true,
    tasks: serializedTasks,
  })
})

export const POST = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  return NextResponse.json({
    success: false,
    error: { code: 'VIDEO_ENHANCE_RETIRED', message: '视频画质增强已停用：旧版 MediaKit 专用服务不再接受新任务。已有完成结果仍可下载。' },
  }, { status: 410 })
})
