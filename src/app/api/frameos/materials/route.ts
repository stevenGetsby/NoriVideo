import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth, requireUserPermission } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { uploadFrameosMaterial } from '@/lib/frameos/material-upload'
import { hasAccountPermissions, isManagementRole } from '@/lib/account/permissions'
import { getWorkspaceActor, projectReadScopeWhere, workspaceUserWhere } from '@/lib/collaboration/access'
import { extractStorageKey, getSignedUrl } from '@/lib/storage'
import { characterVoiceMaterialId } from '@/lib/frameos/character-voice-reference'
import {
  syncGeneratedImagesToMaterialLibrary,
  type FrameosMaterialType,
} from '@/lib/frameos/material-service'

const ALLOWED_TYPES = new Set<FrameosMaterialType>(['image', 'video', 'audio', 'model3d'])
const ALLOWED_SOURCES = new Set(['toolbox', 'creative', 'production', 'upload'])
const ACCOUNT_MATERIAL_PROJECT_IDS = ['global', 'global-asset-hub'] as const

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function normalizeType(value: string | null): FrameosMaterialType | null {
  return value && ALLOWED_TYPES.has(value as FrameosMaterialType)
    ? value as FrameosMaterialType
    : null
}

function dateFilter(value: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export const GET = apiHandler(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams
  const projectId = cleanText(params.get('projectId'))
  const scopedProjectId = projectId && !ACCOUNT_MATERIAL_PROJECT_IDS.includes(projectId as typeof ACCOUNT_MATERIAL_PROJECT_IDS[number])
    ? projectId
    : ''
  const authResult = scopedProjectId
    ? await requireProjectAuthLight(scopedProjectId)
    : await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const actor = getWorkspaceActor(session)
  const available = params.get('available') === '1'
  const type = normalizeType(params.get('type'))
  const requestedSource = cleanText(params.get('source'))
  const source = ALLOWED_SOURCES.has(requestedSource) ? requestedSource : ''
  const query = cleanText(params.get('query'))
  const creator = cleanText(params.get('creator'))
  const creatorExact = params.get('creatorExact') === '1'
  const createdFrom = dateFilter(params.get('createdFrom'))
  const createdTo = dateFilter(params.get('createdTo'))
  const favorite = params.get('favorite') === '1'
  const deleted = params.get('state') === 'deleted'
  const limitRaw = Number(params.get('limit') || 200)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200
  const cursor = cleanText(params.get('cursor'))

  const canSyncWorkspace = isManagementRole(session.user.role)
  const canSyncScopedProject = Boolean(scopedProjectId)
    && hasAccountPermissions({ role: session.user.role, permissions: session.user.permissions }, ['assetWrite'])
  if (!deleted && params.get('sync') === '1' && (canSyncWorkspace || canSyncScopedProject)) {
    await syncGeneratedImagesToMaterialLibrary({
      userId: actor.workspaceOwnerId,
      projectId: projectId || null,
    })
  }

  const [readableProjects, workspaceUsers] = await Promise.all([
    prisma.project.findMany({
      where: projectReadScopeWhere(session),
      select: { id: true, name: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    }),
    prisma.user.findMany({
      where: workspaceUserWhere(actor.workspaceOwnerId),
      select: { id: true, name: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ])
  const workspaceUserIds = workspaceUsers.map((user) => user.id)
  const workspaceUserNames = new Map(workspaceUsers.map((user) => [user.id, user.name]))
  const matchingCreatorUserIds = creator
    ? workspaceUsers
      .filter((user) => creatorExact
        ? user.name.trim() === creator
        : user.name.toLocaleLowerCase().includes(creator.toLocaleLowerCase()))
      .map((user) => user.id)
    : []
  const projectIds = projectId
    ? (available
      ? Array.from(new Set([...readableProjects.map((project) => project.id), ...ACCOUNT_MATERIAL_PROJECT_IDS]))
      : [projectId])
    : [...readableProjects.map((project) => project.id), ...ACCOUNT_MATERIAL_PROJECT_IDS]
  const materials = await prisma.frameosMaterial.findMany({
    where: {
      userId: { in: workspaceUserIds },
      projectId: { in: projectIds },
      deletedAt: deleted ? { not: null } : null,
      ...(type ? { type } : {}),
      ...(source ? { source } : {}),
      ...(favorite ? { isFavorited: true } : {}),
      ...(query ? { title: { contains: query } } : {}),
      ...(creator ? {
        OR: [
          { ownerName: creatorExact ? { equals: creator } : { contains: creator } },
          ...(matchingCreatorUserIds.length > 0 ? [{
            userId: { in: matchingCreatorUserIds },
            // New subaccount uploads share the workspace userId but retain the
            // real creator in ownerName. Never attribute every shared row to
            // the manager; userId is only a fallback for unnamed legacy rows.
            ...(creatorExact ? { OR: [{ ownerName: null }, { ownerName: '' }] } : {}),
          }] : []),
        ],
      } : {}),
      ...(createdFrom || createdTo ? {
        createdAt: {
          ...(createdFrom ? { gte: createdFrom } : {}),
          ...(createdTo ? { lte: createdTo } : {}),
        },
      } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const realProjectIds = Array.from(new Set(materials
    .map((material) => material.projectId)
    .filter((id) => id !== 'global' && id !== 'global-asset-hub')))
  const readableProjectNames = new Map(readableProjects.map((project) => [project.id, project.name]))
  const missingProjectIds = realProjectIds.filter((id) => !readableProjectNames.has(id))
  const projects = missingProjectIds.length > 0
    ? await prisma.project.findMany({
      where: { ...projectReadScopeWhere(session), id: { in: missingProjectIds } },
      select: { id: true, name: true },
    })
    : []
  for (const project of projects) readableProjectNames.set(project.id, project.name)
  const trashCount = await prisma.frameosMaterial.count({
    where: {
      userId: { in: workspaceUserIds },
      projectId: { in: projectIds },
      deletedAt: { not: null },
    },
  })
  const voiceIds = [...new Set(materials.map((material) => characterVoiceMaterialId(material.metadata)).filter((id): id is string => Boolean(id)))]
  const voices = voiceIds.length ? await prisma.frameosMaterial.findMany({
    where: { id: { in: voiceIds }, userId: { in: workspaceUserIds }, projectId: { in: projectIds }, type: 'audio', status: 'ready', deletedAt: null },
  }) : []
  const voicesById = new Map(voices.map((voice) => [voice.id, voice]))

  return NextResponse.json({
    pagination: {
      nextCursor: materials.length === limit ? materials.at(-1)?.id || null : null,
    },
    projects: readableProjects,
    creators: workspaceUsers
      .filter((user) => Boolean(user.name?.trim()))
      .map((user) => ({ id: user.id, name: user.name.trim() })),
    capabilities: {
      trash: {
        supported: true,
        count: trashCount,
        reason: null,
      },
    },
    materials: materials.map((material) => ({
      ...material,
      voice: (() => {
        const voice = voicesById.get(characterVoiceMaterialId(material.metadata) || '')
        if (!voice || ![material.projectId, ...ACCOUNT_MATERIAL_PROJECT_IDS].includes(voice.projectId)) return null
        const key = voice.storageKey || extractStorageKey(voice.resultUrl)
        return { materialId: voice.id, title: voice.title, url: key ? getSignedUrl(key, 3600) : voice.resultUrl }
      })(),
      ownerName: material.ownerName || workspaceUserNames.get(material.userId) || null,
      storageKey: material.storageKey || extractStorageKey(material.resultUrl),
      url: (() => {
        const key = material.storageKey || extractStorageKey(material.resultUrl)
        return key ? getSignedUrl(key, 3600) : material.resultUrl
      })(),
      projectName: material.projectId === 'global' || material.projectId === 'global-asset-hub'
        ? '账号素材'
        : readableProjectNames.get(material.projectId) || '项目素材',
    })),
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserPermission(['assetWrite'])
  if (isErrorResponse(authResult)) return authResult
  return await uploadFrameosMaterial(request, authResult.session)
})
