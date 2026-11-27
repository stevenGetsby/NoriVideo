import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth, requireUserPermission } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { uploadFrameosMaterial } from '@/lib/frameos/material-upload'
import { hasAccountPermissions, isManagementRole } from '@/lib/account/permissions'
import { getWorkspaceActor, projectReadScopeWhere, workspaceUserWhere } from '@/lib/collaboration/access'
import { resolveCanvasAssetProjectIds, resolveProjectAssetScope } from '@/lib/frameos/project-asset-scope'
import { extractStorageKey, getSignedUrl } from '@/lib/storage'
import { PERSONAL_MATERIAL_PROJECT_ID } from '@/lib/frameos/material-ownership'
import { characterVoiceMaterialId } from '@/lib/frameos/character-voice-reference'
import { supersededByMaterialId } from '@/lib/frameos/material-supersede'
import { collapseInheritedDuplicates } from '@/lib/frameos/material-inherit'
import { resolveFrameosVoiceIds, frameosAssetCategoryWhere, frameosMissingVoiceWhere, readFrameosVisibleMaterialPage } from '@/lib/frameos/material-list-query'
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
  const scopedProjectId = projectId && projectId !== PERSONAL_MATERIAL_PROJECT_ID && !ACCOUNT_MATERIAL_PROJECT_IDS.includes(projectId as typeof ACCOUNT_MATERIAL_PROJECT_IDS[number])
    ? projectId
    : ''
  const requestedScope = cleanText(params.get('scope'))
  const currentProject = requestedScope === 'current-project'
  if (currentProject && !scopedProjectId) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择画布所属作品。' })
  }
  const authResult = scopedProjectId
    ? await requireProjectAuthLight(scopedProjectId)
    : await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const actor = getWorkspaceActor(session)
  const workId = cleanText(params.get('workId'))
  const assetScope = workId && !currentProject ? await resolveProjectAssetScope(session, { workId, projectId: scopedProjectId }) : null
  const available = params.get('available') === '1'
  const scope = ['personal', 'project', 'all'].includes(cleanText(params.get('scope'))) ? cleanText(params.get('scope')) : 'all'
  const personal = scope === 'personal' || projectId === PERSONAL_MATERIAL_PROJECT_ID
  const shared = currentProject || scope === 'project'
  const type = normalizeType(params.get('type'))
  const requestedSource = cleanText(params.get('source'))
  const source = ALLOWED_SOURCES.has(requestedSource) ? requestedSource : ''
  const query = cleanText(params.get('query'))
  const canvasId = cleanText(params.get('canvasId'))
  const requestedCategory = cleanText(params.get('category'))
  const category = ['character', 'location', 'prop', 'shot', 'other', 'voice', 'missingVoice'].includes(requestedCategory)
    ? requestedCategory
    : ''
  const deduplicate = params.get('deduplicate') === '1'
  const pageVersion = cleanText(params.get('pageVersion'))
  const requestedSort = cleanText(params.get('sort'))
  const creator = cleanText(params.get('creator'))
  const creatorExact = params.get('creatorExact') === '1'
  const createdFrom = dateFilter(params.get('createdFrom'))
  const createdTo = dateFilter(params.get('createdTo'))
  const favorite = params.get('favorite') === '1'
  const deleted = params.get('state') === 'deleted'
  const limitRaw = Number(params.get('limit') || 200)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200
  const rawCursor = cleanText(params.get('cursor'))
  const cursorParts = pageVersion ? rawCursor.split(':') : []
  const cursor = pageVersion ? cursorParts.slice(4).join(':') : rawCursor
  const cursorCreatedAt = pageVersion && cursorParts.length >= 5 ? dateFilter(cursorParts.slice(1, 4).join(':')) : null
  if (pageVersion && rawCursor && (!cursorCreatedAt || !cursor || !/^\d+$/.test(cursorParts[0]))) {
    throw new ApiError('INVALID_PARAMS', { message: '素材分页游标无效，请刷新后重试。' })
  }
  const ascending = requestedSort === 'oldest'
  const offset = pageVersion ? Number(cursorParts[0]) : 0
  const categoryConditions = category && !['voice', 'missingVoice'].includes(category)
    ? [frameosAssetCategoryWhere(category as Parameters<typeof frameosAssetCategoryWhere>[0])]
    : []
  const voiceWhere = category === 'voice' ? { type: 'audio' } : null

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
      select: { id: true, name: true, workId: true },
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
  // The canvas projectId identifies a work. Derive its parent from ACL-readable
  // rows so automatic matching cannot widen to unrelated projects or libraries.
  const currentWork = currentProject ? readableProjects.find((project) => project.id === scopedProjectId) : undefined
  if (currentProject && !currentWork) throw new ApiError('NOT_FOUND', { message: '作品不存在或当前账号无权访问。' })
  const matchingProjectIds = currentWork ? await resolveCanvasAssetProjectIds(session, currentWork) : null
  const projectIds = matchingProjectIds ?? (personal
    ? [PERSONAL_MATERIAL_PROJECT_ID]
    : assetScope?.projectIds
    || (projectId
    ? (available
      ? Array.from(new Set([...readableProjects.map((project) => project.id), ...ACCOUNT_MATERIAL_PROJECT_IDS]))
      : [projectId])
    : [...readableProjects.map((project) => project.id), ...ACCOUNT_MATERIAL_PROJECT_IDS]))
  const scopeWhere: Prisma.FrameosMaterialWhereInput = {
    userId: { in: workspaceUserIds },
    projectId: personal ? PERSONAL_MATERIAL_PROJECT_ID : { in: projectIds },
    ...(personal
      ? { personalOwnerId: actor.actorId }
      : shared
        ? { personalOwnerId: null }
        : { OR: [
            { personalOwnerId: null },
            { personalOwnerId: actor.actorId, projectId: PERSONAL_MATERIAL_PROJECT_ID },
          ] }),
    deletedAt: deleted ? { not: null } : null,
  }
  const baseWhere: Prisma.FrameosMaterialWhereInput = {
    ...scopeWhere,
    ...(type ? { type } : {}),
    ...(source ? { source } : {}),
    ...(favorite ? { isFavorited: true } : {}),
    ...(canvasId ? { metadata: { path: '$.canvasId', equals: canvasId } } : {}),
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
    ...(query ? { AND: [{ OR: [
      { title: { contains: query } },
      ...(readableProjects.length > 0
        ? [{ projectId: { in: readableProjects.filter((project) => project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((project) => project.id) } }]
        : []),
    ] }] } : {}),
  }
  const missingVoiceWhere: Prisma.FrameosMaterialWhereInput = {
    AND: [baseWhere, frameosAssetCategoryWhere('character'), { type: 'image' }],
  }
  const resolvedVoiceIds = deduplicate && category === 'missingVoice'
    ? await resolveFrameosVoiceIds(missingVoiceWhere, (args) => prisma.frameosMaterial.findMany(args))
    : new Set<string>()
  const where: Prisma.FrameosMaterialWhereInput = {
    AND: [
      baseWhere,
      ...categoryConditions,
      ...(voiceWhere ? [voiceWhere] : []),
      ...(category === 'missingVoice' ? [{ type: 'image' }, frameosMissingVoiceWhere(resolvedVoiceIds)] : []),
    ],
  }
  const visiblePage = deduplicate ? null : await readFrameosVisibleMaterialPage({
    where, ascending, limit, cursor: cursor ? { id: cursor, createdAt: cursorCreatedAt } : undefined,
  }, (args) => prisma.frameosMaterial.findMany(args))
  const filteredMaterials = visiblePage ?? (await prisma.frameosMaterial.findMany({
    where,
    orderBy: [{ createdAt: ascending ? 'asc' : 'desc' }, { id: ascending ? 'asc' : 'desc' }],
    select: { id: true, projectId: true, createdAt: true, metadata: true },
  })).filter((material) => !supersededByMaterialId(material.metadata))
  const trashCount = await prisma.frameosMaterial.count({ where: { ...scopeWhere, deletedAt: { not: null } } })
  const pinnedIds = new Set(params.getAll('pinnedId').slice(0, 100))
  const allVisibleMaterials = deduplicate && !deleted
    ? collapseInheritedDuplicates(filteredMaterials.map((material) => ({ ...material, createdAt: material.createdAt.toISOString() })), scopedProjectId, pinnedIds)
    : filteredMaterials
  const filteredIds = allVisibleMaterials.map((material) => material.id)
  const pageMaterials = deduplicate ? allVisibleMaterials.slice(offset, offset + limit + 1) : allVisibleMaterials.slice(0, limit + 1)
  const materials = pageMaterials.slice(0, limit)
  const detailIds = materials.map((material) => material.id)
  const materialRows = visiblePage?.slice(0, limit)
    ?? await prisma.frameosMaterial.findMany({ where: { id: { in: detailIds } } })
  const materialsById = new Map(materialRows.map((material) => [material.id, material]))
  const orderedMaterials = detailIds.map((id) => materialsById.get(id)).filter((material): material is NonNullable<typeof material> => Boolean(material))
  const realProjectIds = Array.from(new Set(orderedMaterials
    .map((material) => material.projectId)
    .filter((id) => id !== 'global' && id !== 'global-asset-hub' && id !== PERSONAL_MATERIAL_PROJECT_ID)))
  const readableProjectNames = new Map(readableProjects.map((project) => [project.id, project.name]))
  const missingProjectIds = realProjectIds.filter((id) => !readableProjectNames.has(id))
  const projects = missingProjectIds.length > 0
    ? await prisma.project.findMany({
      where: { ...projectReadScopeWhere(session), id: { in: missingProjectIds } },
      select: { id: true, name: true },
    })
    : []
  for (const project of projects) readableProjectNames.set(project.id, project.name)
  const voiceIds = [...new Set(orderedMaterials.map((material) => characterVoiceMaterialId(material.metadata)).filter((id): id is string => Boolean(id)))]
  const voices = voiceIds.length ? await prisma.frameosMaterial.findMany({
    where: { ...scopeWhere, id: { in: voiceIds }, type: 'audio', status: 'ready', deletedAt: null },
  }) : []
  const voicesById = new Map(voices.map((voice) => [voice.id, voice]))

  const nextMaterial = materials.at(-1)
  const nextCursor = materials.length === limit && pageMaterials.length > limit && nextMaterial
    ? pageVersion
      ? `${offset + limit}:${new Date(nextMaterial.createdAt).toISOString()}:${nextMaterial.id}`
      : nextMaterial.id
    : null
  const allVoiceIds = deduplicate
    ? await resolveFrameosVoiceIds(missingVoiceWhere, (args) => prisma.frameosMaterial.findMany(args))
    : new Set<string>()
  const missingVoiceCandidates = deduplicate ? await prisma.frameosMaterial.count({
    where: { AND: [missingVoiceWhere, frameosMissingVoiceWhere(allVoiceIds)] },
  }) : 0

  return NextResponse.json({
    pagination: {
      nextCursor,
      ...(deduplicate ? { total: filteredIds.length, missingVoiceCount: missingVoiceCandidates } : {}),
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
    materials: orderedMaterials.map((material) => ({
      ...material,
      voice: (() => {
        const voice = voicesById.get(characterVoiceMaterialId(material.metadata) || '')
        if (!voice) return null
        const key = voice.storageKey || extractStorageKey(voice.resultUrl)
        return { materialId: voice.id, title: voice.title, url: key ? getSignedUrl(key, 3600) : voice.resultUrl }
      })(),
      canEdit: !material.personalOwnerId || material.personalOwnerId === actor.actorId,
      personal: material.personalOwnerId === actor.actorId && material.projectId === PERSONAL_MATERIAL_PROJECT_ID,
      ownerName: material.ownerName || workspaceUserNames.get(material.userId) || null,
      storageKey: material.storageKey || extractStorageKey(material.resultUrl),
      url: (() => {
        const key = material.storageKey || extractStorageKey(material.resultUrl)
        return key ? getSignedUrl(key, 3600) : material.resultUrl
      })(),
      projectName: material.personalOwnerId === actor.actorId && material.projectId === PERSONAL_MATERIAL_PROJECT_ID
        ? '个人素材'
        : material.projectId === 'global' || material.projectId === 'global-asset-hub'
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
