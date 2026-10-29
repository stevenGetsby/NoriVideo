import type { Prisma } from '@prisma/client'
import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { getWorkAccess, getWorkspaceActor, projectReadScopeWhere, requireWorkProjectCreator, workReadScopeWhere } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { compileChapter } from './compile'
import { isStoryAspectRatio, isStoryResolution, normalizeStoryConfig, parseStoryConfigInput, reconcileStoryChapters } from './config'
import type { InteractiveStoryConfig, StoryAspectRatio, StoryResolution } from './types'

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

async function requireStory(session: AuthSession, workId: string) {
  const access = await getWorkAccess(session, workId)
  const story = await prisma.interactiveStory.findUnique({ where: { workId } })
  if (!story) throw new ApiError('NOT_FOUND', { message: '影游项目不存在。' })
  const projectIds = access.work.projects.map((project) => project.id)
  return { access, story, config: reconcileStoryChapters(normalizeStoryConfig(story.config), projectIds), projectIds }
}

export async function listInteractiveStories(session: AuthSession) {
  const works = await prisma.work.findMany({
    where: { ...workReadScopeWhere(session), interactiveStory: { isNot: null } },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      interactiveStory: { select: { aspectRatio: true, resolution: true, updatedAt: true } },
      _count: { select: { projects: { where: { deletedAt: null } } } },
    },
  })
  return works.map((work) => ({
    workId: work.id,
    name: work.name,
    aspectRatio: work.interactiveStory?.aspectRatio ?? '9:16',
    resolution: work.interactiveStory?.resolution ?? '1080p',
    chapterCount: work._count.projects,
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
    data: { name: input.name, userId: actor.workspaceOwnerId, workId: input.workId, createdById: actor.actorId },
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
        members: { create: [{ userId: actor.actorId, role: 'manager', canManage: true }] },
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

/** The story a chapter 作品 belongs to, or null when the 作品 is an ordinary one. */
export async function findInteractiveStoryByProject(session: AuthSession, projectId: string) {
  const project = await prisma.project.findFirst({ where: { ...projectReadScopeWhere(session), id: projectId }, select: { workId: true } })
  if (!project) return null
  const exists = await prisma.interactiveStory.findUnique({ where: { workId: project.workId }, select: { id: true } })
  if (!exists) return null
  const { access, story, config } = await requireStory(session, project.workId)
  const chapters = await prisma.project.findMany({
    where: { ...projectReadScopeWhere(session), workId: project.workId },
    select: { id: true, name: true },
  })
  return {
    workId: project.workId,
    name: access.work.name,
    aspectRatio: story.aspectRatio,
    resolution: story.resolution,
    canManage: access.canManage,
    config,
    chapters: chapters.map((chapter) => ({ projectId: chapter.id, name: chapter.name })),
  }
}

export async function getInteractiveStory(session: AuthSession, workId: string) {
  const { access, story, config } = await requireStory(session, workId)
  const projects = await prisma.project.findMany({
    where: { ...projectReadScopeWhere(session), workId },
    select: {
      id: true,
      name: true,
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
  const chapters = projects.map((project) => {
    const canvas = project.canvases[0]
    const nodes = canvas?.nodes ?? []
    const edges = (canvas?.edges ?? []).map((edge) => ({
      id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, sourceHandle: edge.sourceHandle, role: edge.role,
    }))
    return {
      projectId: project.id,
      name: project.name,
      canvasId: canvas?.id ?? null,
      nodeCount: nodes.length,
      runningCount: nodes.filter((node) => node.status === 'RUNNING' || node.status === 'QUEUED').length,
      updatedAt: (canvas && canvas.updatedAt > project.updatedAt ? canvas.updatedAt : project.updatedAt).toISOString(),
      graph: compileChapter({ projectId: project.id, title: project.name }, nodes, edges),
    }
  })
  return {
    story: {
      workId,
      name: access.work.name,
      aspectRatio: story.aspectRatio,
      resolution: story.resolution,
      canManage: access.canManage,
      canCreateChapters: access.canCreateProjects,
      config,
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
    const patch = input.config && typeof input.config === 'object' && !Array.isArray(input.config)
      ? { ...stored, ...input.config as Record<string, unknown> }
      : input.config
    const parsed = parseStoryConfigInput(patch)
    if (!parsed.ok) throw new ApiError('INVALID_PARAMS', { message: parsed.message })
    config = reconcileStoryChapters(parsed.config, projectIds)
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
