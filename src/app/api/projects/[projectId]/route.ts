import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { addSignedUrlsToProject } from '@/lib/storage'
import { logProjectAction } from '@/lib/logging/semantic'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getWorkspaceActor, projectReadWhere, requireProjectManager, requireProjectReader } from '@/lib/collaboration/access'
import { PROJECT_RECYCLE_RETENTION_MS } from '@/lib/projects/recycle-bin'
import { toProductionWork } from '@/lib/projects/hierarchy'
import { projectCoverImageUrl } from '@/lib/projects/project-cover-url'

function readOptionalString(value: unknown, maxLength: number) {
  if (value === null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLength)
}

function readNullableOptionalString(value: unknown, maxLength: number) {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

// GET - 获取作品详情
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // 只获取基础作品信息，不包含模式特定数据
  const project = await prisma.project.findFirst({
    where: projectReadWhere(session, projectId)
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  // 更新最近访问时间（异步，不阻塞响应）
  prisma.project.update({
    where: { id: project.id },
    data: { lastAccessedAt: new Date() }
  }).catch(err => _ulogError('更新访问时间失败:', err))

  // 这个 API 只返回基础作品信息
  // 作品附属业务数据通过各自的 API 获取（如 /api/novel-promotion/[projectId]）
  const projectWithSignedUrls = {
    ...project,
    ...addSignedUrlsToProject(project),
    coverImageUrl: projectCoverImageUrl(project.coverImageKey),
  }

  return NextResponse.json({ work: toProductionWork(projectWithSignedUrls), project: projectWithSignedUrls })
})

// PATCH - 更新作品配置
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  await requireProjectReader(session, projectId)

  const project = await prisma.project.findFirst({
    where: projectReadWhere(session, projectId)
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  const updateData: {
    name?: string
    description?: string | null
  } = {}
  const nextName = readOptionalString(body?.name, 191)
  const nextDescription = readNullableOptionalString(body?.description, 5000)
  if (nextName !== undefined) updateData.name = nextName
  if (nextDescription !== undefined) updateData.description = nextDescription
  if (Object.keys(updateData).length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 更新作品
  const updatedProject = await prisma.project.update({
    where: { id: project.id },
    data: updateData
  })

  logProjectAction(
    'UPDATE',
    session.user.id,
    session.user.name,
    projectId,
    updatedProject.name,
    { changes: updateData }
  )

  return NextResponse.json({
    work: toProductionWork({ ...updatedProject, coverImageUrl: projectCoverImageUrl(updatedProject.coverImageKey) }),
    project: { ...updatedProject, coverImageUrl: projectCoverImageUrl(updatedProject.coverImageKey) },
  })
})

// DELETE - 将作品移入回收站，15 天内可恢复；到期后由后台清理器硬删除。
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session
  await requireProjectManager(session, projectId)

  const project = await prisma.project.findFirst({
    where: projectReadWhere(session, projectId)
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  const deletedAt = new Date()
  const restoreDeadline = new Date(deletedAt.getTime() + PROJECT_RECYCLE_RETENTION_MS)
  await prisma.project.update({
    where: { id: project.id },
    data: {
      deletedAt,
      deletedById: getWorkspaceActor(session).actorId,
      deletedWithWork: false,
    },
  })

  logProjectAction(
    'DELETE',
    session.user.id,
    session.user.name,
    projectId,
    project.name,
    {
      projectName: project.name,
      recycleBin: {
        deletedAt: deletedAt.toISOString(),
        restoreDeadline: restoreDeadline.toISOString(),
      },
    }
  )

  _ulogInfo(`[DELETE] 作品已移入回收站: ${project.name}`)

  return NextResponse.json({
    success: true,
    deletedAt: deletedAt.toISOString(),
    restoreDeadline: restoreDeadline.toISOString(),
  })
})
