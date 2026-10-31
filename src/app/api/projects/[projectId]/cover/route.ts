import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectManager } from '@/lib/collaboration/access'
import {
  deleteProjectCoverObject,
  prepareProjectCoverImage,
  uploadProjectCoverImage,
} from '@/lib/projects/project-cover-image'
import { projectCoverImageUrl } from '@/lib/projects/project-cover-url'

function coverConflict() {
  return new ApiError('CONFLICT', {
    code: 'PROJECT_COVER_CONFLICT',
    message: '封面已被更新，请刷新后重试。',
  })
}

// POST - upload or replace a project cover image.
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Ownership/visibility is resolved here; updating a repeated project id cannot
  // reach another workspace because projectReadWhere scopes every actor.
  const access = await requireProjectManager(session, projectId)
  const project = access.project

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_COVER_FILE_REQUIRED',
      field: 'file',
      message: '请选择一张封面图片。',
    })
  }

  const prepared = await prepareProjectCoverImage(file)
  const nextKey = await uploadProjectCoverImage(project.id, prepared)

  try {
    const switched = await prisma.project.updateMany({
      where: {
        id: project.id,
        userId: project.userId,
        coverImageKey: project.coverImageKey ?? null,
      },
      data: { coverImageKey: nextKey },
    })
    if (switched.count !== 1) throw coverConflict()
  } catch (error) {
    // The DB did not accept the new key, so the just-uploaded object is orphaned.
    await deleteProjectCoverObject(nextKey)
    throw error
  }

  // The DB now points at the new object; old-object cleanup is best effort.
  await deleteProjectCoverObject(project.coverImageKey)

  return NextResponse.json({
    success: true,
    projectId: project.id,
    coverImageKey: nextKey,
    coverImageUrl: projectCoverImageUrl(nextKey),
  })
})

// DELETE - remove the custom cover and fall back to the generative cover.
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const access = await requireProjectManager(session, projectId)
  const project = access.project
  const previousKey = project.coverImageKey
  if (!previousKey) {
    return NextResponse.json({ success: true, projectId: project.id, coverImageKey: null, coverImageUrl: null })
  }

  const cleared = await prisma.project.updateMany({
    where: {
      id: project.id,
      userId: project.userId,
      coverImageKey: previousKey,
    },
    data: { coverImageKey: null },
  })
  if (cleared.count !== 1) throw coverConflict()

  await deleteProjectCoverObject(previousKey)

  return NextResponse.json({
    success: true,
    projectId: project.id,
    coverImageKey: null,
    coverImageUrl: null,
  })
})
