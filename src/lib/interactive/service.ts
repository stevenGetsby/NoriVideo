import type { Prisma } from '@prisma/client'
import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import {
  findHiddenProjectIds,
  getWorkAccess,
  getWorkspaceActor,
  projectReadScopeWhere,
  requireWorkProjectCreator,
  workReadScopeWhere,
} from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { logProjectAction } from '@/lib/logging/semantic'
import { PROJECT_RECYCLE_RETENTION_MS } from '@/lib/projects/recycle-bin'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from './compile'
import {
  findStoryLinkCycle,
  isStoryAspectRatio,
  isStoryResolution,
  normalizeStoryConfig,
  parseStoryConfigInput,
  reconcileStoryChapters,
} from './config'
import { ensureStorySequence, sequenceSegmentKey } from './sequence'
import type { InteractiveStoryConfig, StoryAspectRatio, StoryChapterGraph, StoryResolution } from './types'

const NAME_MAX = 50

function readName(value: unknown, label: string): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw new ApiError('INVALID_PARAMS', { message: `请输入${label}名称。` })
  if (name.length > NAME_MAX) throw new ApiError('INVALID_PARAMS', { message: `${label}名称不能超过 ${NAME_MAX} 个字符。` })
  return name
}

function readFormat(input: { aspectRatio?: unknown; resolution?: unknown }) {
  if (input.aspectRatio !== undefined && !isStoryAspectRatio(input.aspectRatio)) {
    throw new ApiError('INVALID_PARAMS', { message: '画幅只能是 9:16 或 16:9。' })
  }
  if (input.resolution !== undefined && !isStoryResolution(input.resolution)) {
    throw new ApiError('INVALID_PARAMS', { message: '分辨率只能是 480p、720p、1080p 或 4K。' })
  }
  return { aspectRatio: input.aspectRatio as StoryAspectRatio | undefined, resolution: input.resolution as StoryResolution | undefined }
}

const toJson = (config: InteractiveStoryConfig) => config as unknown as Prisma.InputJsonValue

function configPatchKeys(value: unknown): Set<string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Set()
  return new Set(Object.keys(value))
}

/** Compiles the first canvas of each referenced chapter for PATCH reference checks. */
async function loadStoryGraphs(session: AuthSession, workId: string, projectIds: string[]): Promise<Map<string, StoryChapterGraph>> {
  const graphs = new Map<string, StoryChapterGraph>()
  if (!projectIds.length) return graphs
  const projects = await prisma.project.findMany({
    where: { ...projectReadScopeWhere(session), workId, id: { in: projectIds } },
    select: {
      id: true,
      canvases: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          nodes: { select: { id: true, type: true, data: true } },
          edges: { select: { id: true, sourceNodeId: true, targetNodeId: true, sourceHandle: true, role: true } },
        },
      },
    },
  })
  for (const project of projects ?? []) {
    const canvas = project.canvases[0]
    const nodes = (canvas?.nodes ?? []) as CanvasNodeLike[]
    const edges = (canvas?.edges ?? []).map((edge) => ({
      id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, sourceHandle: edge.sourceHandle, role: edge.role,
    })) satisfies CanvasEdgeLike[]
    graphs.set(project.id, compileChapter({ projectId: project.id, title: '' }, nodes, edges))
  }
  return graphs
}

/**
 * PATCH guard for the three layers: project ownership, hidden chapters, link
 * cycles and orphan node references. Existing orphaned work segments stay
 * valid so a deleted scene can be recovered instead of blocking every save.
 */
async function assertStoryConfigReferences(
  session: AuthSession,
  workId: string,
  projectIds: string[],
  config: InteractiveStoryConfig,
  stored: InteractiveStoryConfig,
  keys: Set<string>,
): Promise<Map<string, StoryChapterGraph> | null> {
  const owned = new Set(projectIds)
  const referenced = new Set<string>()
  const requireOwned = (projectId: string, label: string, allowStoredOrphan = false) => {
    if (!owned.has(projectId)) {
      if (allowStoredOrphan) return false
      throw new ApiError('INVALID_PARAMS', { message: `${label}不属于该影游。` })
    }
    referenced.add(projectId)
    return true
  }

  if (keys.has('chapters')) {
    for (const chapter of config.chapters) requireOwned(chapter.projectId, '章节')
  }
  if (keys.has('links')) {
    for (const link of config.links) {
      requireOwned(link.fromProjectId, '章节连线')
      requireOwned(link.toProjectId, '章节连线')
    }
    if (findStoryLinkCycle(config.links)) {
      throw new ApiError('INVALID_PARAMS', { message: '章节连线形成了循环，观众会回到已经走过的章节。' })
    }
  }
  if (keys.has('start') && config.start) requireOwned(config.start.projectId, '故事起点')

  const storedSegments = new Set((stored.sequence?.segments ?? []).map((segment) => sequenceSegmentKey(segment.projectId, segment.sceneNodeId)))
  const sequenceSegments = keys.has('sequence') ? config.sequence?.segments ?? [] : []
  for (const segment of sequenceSegments) {
    const key = sequenceSegmentKey(segment.projectId, segment.sceneNodeId)
    if (!requireOwned(segment.projectId, '作品片段', storedSegments.has(key))) continue
  }

  if (referenced.size) {
    const hidden = await findHiddenProjectIds(session, Array.from(referenced))
    if (hidden.size) throw new ApiError('FORBIDDEN', { message: '故事配置引用了无权访问的作品。' })
  }

  const needsNodes = keys.has('links') || keys.has('start') || keys.has('sequence')
  if (!needsNodes) return null
  const graphProjectIds = keys.has('sequence') ? projectIds : Array.from(referenced)
  const graphs = await loadStoryGraphs(session, workId, graphProjectIds)
  const nodeOf = (projectId: string, nodeId: string) => graphs.get(projectId)?.nodes.find((node) => node.id === nodeId)

  if (keys.has('links')) {
    for (const link of config.links) {
      if (nodeOf(link.fromProjectId, link.exitNodeId)?.kind !== 'exit') {
        throw new ApiError('INVALID_PARAMS', { message: '章节连线指向了已删除的出口。' })
      }
      if (nodeOf(link.toProjectId, link.toEntryNodeId)?.kind !== 'entry') {
        throw new ApiError('INVALID_PARAMS', { message: '章节连线指向了已删除的入口。' })
      }
    }
  }
  if (keys.has('start') && config.start) {
    if (nodeOf(config.start.projectId, config.start.entryNodeId)?.kind !== 'entry') {
      throw new ApiError('INVALID_PARAMS', { message: '故事起点指向的入口已被删除。' })
    }
  }
  for (const segment of sequenceSegments) {
    const key = sequenceSegmentKey(segment.projectId, segment.sceneNodeId)
    if (!owned.has(segment.projectId)) continue
    if (nodeOf(segment.projectId, segment.sceneNodeId)?.kind === 'scene') continue
    if (!storedSegments.has(key)) {
      throw new ApiError('INVALID_PARAMS', { message: '作品片段指向了已删除的剧情片段。' })
    }
  }
  return graphs
}

async function requireStory(session: AuthSession, workId: string) {
  const access = await getWorkAccess(session, workId)
  const story = await prisma.interactiveStory.findUnique({ where: { workId } })
  if (!story) throw new ApiError('NOT_FOUND', { message: '影游项目不存在。' })
  const projectIds = access.work.projects.map((project) => project.id)
  return { access, story, config: reconcileStoryChapters(normalizeStoryConfig(story.config), projectIds), projectIds }
}

/** For routes that only need to know the viewer may work on this 影游 (e.g. uploading its art). */
export async function requireInteractiveStoryAccess(session: AuthSession, workId: string) {
  const access = await getWorkAccess(session, workId)
  const exists = await prisma.interactiveStory.findUnique({ where: { workId }, select: { id: true } })
  if (!exists) throw new ApiError('NOT_FOUND', { message: '影游项目不存在。' })
  return access
}

export async function listInteractiveStories(session: AuthSession) {
  const works = await prisma.work.findMany({
    where: { ...workReadScopeWhere(session), productLine: 'story' },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      interactiveStory: { select: { aspectRatio: true, resolution: true, updatedAt: true } },
      _count: { select: { projects: { where: { deletedAt: null } }, members: true } },
    },
  })
  return works.map((work) => ({
    workId: work.id,
    name: work.name,
    aspectRatio: work.interactiveStory?.aspectRatio ?? '9:16',
    resolution: work.interactiveStory?.resolution ?? '1080p',
    chapterCount: work._count.projects,
    memberCount: work._count.members,
    updatedAt: (work.interactiveStory && work.interactiveStory.updatedAt > work.updatedAt ? work.interactiveStory.updatedAt : work.updatedAt).toISOString(),
  }))
}

async function insertChapter(
  tx: Prisma.TransactionClient,
  session: AuthSession,
  input: { workId: string; name: string; aspectRatio: string; resolution: string },
) {
  const actor = getWorkspaceActor(session)
  const project = await tx.project.create({
    data: { name: input.name, userId: actor.workspaceOwnerId, workId: input.workId, createdById: actor.actorId, creationMode: 'canvas' },
    select: { id: true, name: true },
  })
  await tx.novelPromotionProject.create({
    data: { projectId: project.id, videoRatio: input.aspectRatio, videoResolution: input.resolution },
  })
  const canvas = await tx.canvas.create({
    data: { projectId: project.id, userId: session.user.id, title: input.name, viewport: { x: 160, y: 200, zoom: 1 } },
    select: { id: true },
  })
  const entry = await tx.canvasNode.create({
    data: { canvasId: canvas.id, type: 'story_entry', position: { x: 0, y: 0 }, size: { width: 220, height: 96 }, data: { title: '开场' } },
    select: { id: true },
  })
  return { projectId: project.id, name: project.name, canvasId: canvas.id, entryNodeId: entry.id }
}

export async function createInteractiveStory(session: AuthSession, input: { name?: unknown; aspectRatio?: unknown; resolution?: unknown }) {
  const actor = getWorkspaceActor(session)
  if (!actor.isManagement && !actor.projectLeader) {
    throw new ApiError('FORBIDDEN', { message: '当前账号不是项目组长，请联系管理员设置。' })
  }
  const name = readName(input.name, '影游')
  const format = readFormat(input)
  const aspectRatio = format.aspectRatio ?? '9:16'
  const resolution = format.resolution ?? '1080p'
  return prisma.$transaction(async (tx) => {
    const work = await tx.work.create({
      data: {
        workspaceOwnerId: actor.workspaceOwnerId,
        createdById: actor.actorId,
        name,
        productLine: 'story',
        members: { create: [{ userId: actor.actorId, role: 'member', canManage: false }] },
      },
      select: { id: true, name: true },
    })
    const chapter = await insertChapter(tx, session, { workId: work.id, name: '第 1 章', aspectRatio, resolution })
    const config = reconcileStoryChapters(
      { version: 1, variables: [], chapters: [], links: [], start: { projectId: chapter.projectId, entryNodeId: chapter.entryNodeId } },
      [chapter.projectId],
    )
    await tx.interactiveStory.create({ data: { workId: work.id, aspectRatio, resolution, config: toJson(config), createdById: actor.actorId } })
    return { workId: work.id, name: work.name, aspectRatio, resolution, firstChapter: chapter }
  })
}

/** Where a chapter 作品 lives, or null when the 作品 is not a 影游 chapter. */
export async function findStoryChapterRoute(session: AuthSession, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { ...projectReadScopeWhere(session), id: projectId },
    select: { id: true, work: { select: { id: true, productLine: true } } },
  })
  if (!project || project.work.productLine !== 'story') return null
  return { workId: project.work.id, projectId: project.id }
}

/** The story a chapter 作品 belongs to, or null when the 作品 is an ordinary one. */
export async function findInteractiveStoryByProject(session: AuthSession, projectId: string) {
  const route = await findStoryChapterRoute(session, projectId)
  if (!route) return null
  const { access, story, config } = await requireStory(session, route.workId)
  const chapters = await prisma.project.findMany({
    where: { ...projectReadScopeWhere(session), workId: route.workId },
    select: { id: true, name: true },
  })
  // Follow the story's own chapter order instead of the database's arbitrary row order.
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]))
  const ordered = config.chapters.flatMap((chapter) => {
    const row = byId.get(chapter.projectId)
    return row ? [{ projectId: row.id, name: row.name, order: chapter.order }] : []
  })
  return {
    workId: route.workId,
    name: access.work.name,
    aspectRatio: story.aspectRatio,
    resolution: story.resolution,
    canManage: access.canManage,
    config,
    chapters: ordered,
  }
}

type StoryChapterRow = {
  projectId: string
  name: string
  description: string | null
  canvasId: string | null
  nodeCount: number
  runningCount: number
  updatedAt: string
  graph: StoryChapterGraph
}

async function loadStoryChapters(workId: string, projectWhere: Prisma.ProjectWhereInput): Promise<StoryChapterRow[]> {
  const projects = await prisma.project.findMany({
    where: { ...projectWhere, workId },
    select: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
      canvases: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          id: true,
          updatedAt: true,
          nodes: { select: { id: true, type: true, data: true, status: true } },
          edges: { select: { id: true, sourceNodeId: true, targetNodeId: true, sourceHandle: true, role: true } },
        },
      },
    },
  })
  return projects.map((project) => {
    const canvas = project.canvases[0]
    const nodes = canvas?.nodes ?? []
    const edges = (canvas?.edges ?? []).map((edge) => ({
      id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, sourceHandle: edge.sourceHandle, role: edge.role,
    }))
    return {
      projectId: project.id,
      name: project.name,
      description: project.description,
      canvasId: canvas?.id ?? null,
      nodeCount: nodes.length,
      runningCount: nodes.filter((node) => node.status === 'RUNNING' || node.status === 'QUEUED').length,
      updatedAt: (canvas && canvas.updatedAt > project.updatedAt ? canvas.updatedAt : project.updatedAt).toISOString(),
      graph: compileChapter({ projectId: project.id, title: project.name }, nodes, edges),
    }
  })
}

/** Session-free full load for the release pipeline; callers must have already checked publish permission. */
export async function loadStoryForRelease(workId: string): Promise<{
  story: { workId: string; name: string; aspectRatio: string; resolution: string; config: InteractiveStoryConfig & { sequence: unknown } }
  chapters: StoryChapterRow[]
}> {
  const work = await prisma.work.findFirst({ where: { id: workId, deletedAt: null }, select: { id: true, name: true } })
  const story = await prisma.interactiveStory.findUnique({ where: { workId } })
  if (!work || !story) throw new ApiError('NOT_FOUND', { message: '影游项目不存在。' })
  const chapters = await loadStoryChapters(workId, { deletedAt: null })
  const config = reconcileStoryChapters(normalizeStoryConfig(story.config), chapters.map((chapter) => chapter.projectId))
  const sequence = ensureStorySequence(config, chapters.map((chapter) => chapter.graph), config.sequence)
  return {
    story: { workId, name: work.name, aspectRatio: story.aspectRatio, resolution: story.resolution, config: { ...config, sequence } },
    chapters,
  }
}

export async function getInteractiveStory(session: AuthSession, workId: string) {
  const { access, story, config } = await requireStory(session, workId)
  const chapters = await loadStoryChapters(workId, projectReadScopeWhere(session))
  const sequence = ensureStorySequence(config, chapters.map((chapter) => chapter.graph), config.sequence)
  return {
    story: {
      workId,
      name: access.work.name,
      aspectRatio: story.aspectRatio,
      resolution: story.resolution,
      canManage: access.canManage,
      canCreateChapters: access.canCreateProjects,
      canManageMembers: access.canManageMembers,
      config: { ...config, sequence },
    },
    chapters,
  }
}

export async function updateInteractiveStory(
  session: AuthSession,
  workId: string,
  input: { name?: unknown; aspectRatio?: unknown; resolution?: unknown; config?: unknown },
) {
  const { access, story, projectIds, config: stored } = await requireStory(session, workId)
  const name = input.name === undefined ? undefined : readName(input.name, '影游')
  if (name !== undefined && !access.canManage) throw new ApiError('FORBIDDEN', { message: '当前账号没有管理该项目的权限。' })
  const { aspectRatio, resolution } = readFormat(input)
  let config: InteractiveStoryConfig | undefined
  if (input.config !== undefined) {
    // Keys the client leaves out keep their stored value, so a variables-only patch cannot wipe links.
    const keys = configPatchKeys(input.config)
    const patch = input.config && typeof input.config === 'object' && !Array.isArray(input.config)
      ? { ...stored, ...input.config as Record<string, unknown> }
      : input.config
    const parsed = parseStoryConfigInput(patch)
    if (!parsed.ok) throw new ApiError('INVALID_PARAMS', { message: parsed.message })
    const graphs = await assertStoryConfigReferences(session, workId, projectIds, parsed.config, stored, keys)
    config = reconcileStoryChapters(parsed.config, projectIds)
    if (keys.has('sequence')) {
      const liveGraphs = graphs ? Array.from(graphs.values()) : []
      config = { ...config, sequence: ensureStorySequence(config, liveGraphs, parsed.config.sequence) }
    }
  }
  await prisma.$transaction(async (tx) => {
    if (name !== undefined) await tx.work.update({ where: { id: workId }, data: { name } })
    await tx.interactiveStory.update({
      where: { id: story.id },
      data: {
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(resolution ? { resolution } : {}),
        ...(config ? { config: toJson(config) } : {}),
      },
    })
    if (aspectRatio || resolution) {
      await tx.novelPromotionProject.updateMany({
        where: { projectId: { in: projectIds } },
        data: { ...(aspectRatio ? { videoRatio: aspectRatio } : {}), ...(resolution ? { videoResolution: resolution } : {}) },
      })
    }
  })
  return getInteractiveStory(session, workId)
}

export async function deleteInteractiveChapter(session: AuthSession, workId: string, projectId: string) {
  const { access, story, config } = await requireStory(session, workId)
  const project = await prisma.project.findFirst({
    where: { id: projectId, workId, userId: access.actor.workspaceOwnerId, deletedAt: null },
    select: { id: true, name: true, createdById: true },
  })
  if (!project || !config.chapters.some((chapter) => chapter.projectId === projectId)) {
    throw new ApiError('NOT_FOUND', { message: '章节不存在。' })
  }
  if (!access.actor.isManagement && project.createdById !== access.actor.actorId) {
    throw new ApiError('FORBIDDEN', { message: '只有章节创建者可以删除该章节。' })
  }
  const chapters = config.chapters.filter((chapter) => chapter.projectId !== projectId)
  if (!chapters.length) throw new ApiError('INVALID_PARAMS', { message: '影游至少需要保留一个章节，不能删除最后一章。' })
  const deletedAt = new Date()
  const restoreDeadline = new Date(deletedAt.getTime() + PROJECT_RECYCLE_RETENTION_MS)
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.project.updateMany({
      where: {
        id: projectId,
        workId,
        userId: access.actor.workspaceOwnerId,
        deletedAt: null,
        ...(access.actor.isManagement ? {} : { createdById: access.actor.actorId }),
      },
      data: { deletedAt, deletedById: access.actor.actorId, deletedWithWork: false },
    })
    if (deleted.count !== 1) throw new ApiError('CONFLICT', { message: '章节已被删除，请刷新后重试。' })
    const fallbackEntry = config.start?.projectId === projectId ? await tx.canvasNode.findFirst({
      where: { canvas: { projectId: chapters[0].projectId }, type: 'story_entry' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }) : null
    const next = reconcileStoryChapters({
      ...config,
      chapters: chapters.map((chapter, order) => ({ ...chapter, order })),
      links: config.links.filter((link) => link.fromProjectId !== projectId && link.toProjectId !== projectId),
      start: config.start?.projectId === projectId
        ? (fallbackEntry ? { projectId: chapters[0].projectId, entryNodeId: fallbackEntry.id } : null)
        : config.start,
      ...(config.sequence ? {
        sequence: { ...config.sequence, segments: config.sequence.segments.filter((segment) => segment.projectId !== projectId) },
      } : {}),
    }, chapters.map((chapter) => chapter.projectId))
    await tx.interactiveStory.update({ where: { id: story.id }, data: { config: toJson(next) } })
    await tx.work.update({ where: { id: workId }, data: { updatedAt: new Date() } })
  })
  logProjectAction('DELETE', session.user.id, session.user.name, projectId, project.name, {
    projectName: project.name,
    workId,
    recycleBin: { deletedAt: deletedAt.toISOString(), restoreDeadline: restoreDeadline.toISOString() },
  })
  return { success: true, deletedAt: deletedAt.toISOString(), restoreDeadline: restoreDeadline.toISOString() }
}

export async function createInteractiveChapter(session: AuthSession, workId: string, input: { name?: unknown }) {
  await requireWorkProjectCreator(session, workId)
  const { story, config } = await requireStory(session, workId)
  const name = input.name === undefined || input.name === '' ? `第 ${config.chapters.length + 1} 章` : readName(input.name, '章节')
  return prisma.$transaction(async (tx) => {
    const chapter = await insertChapter(tx, session, { workId, name, aspectRatio: story.aspectRatio, resolution: story.resolution })
    const last = config.chapters[config.chapters.length - 1]
    const next = reconcileStoryChapters({
      ...config,
      chapters: [...config.chapters, {
        projectId: chapter.projectId,
        order: config.chapters.length,
        position: { x: last ? last.position.x + 340 : 0, y: last?.position.y ?? 0 },
        status: 'drafting',
      }],
      start: config.start ?? { projectId: chapter.projectId, entryNodeId: chapter.entryNodeId },
    }, [...config.chapters.map((item) => item.projectId), chapter.projectId])
    await tx.interactiveStory.update({ where: { id: story.id }, data: { config: toJson(next) } })
    await tx.work.update({ where: { id: workId }, data: { updatedAt: new Date() } })
    return chapter
  })
}
