import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { syncProjectAssignmentsForProject } from '@/lib/collaboration/assignments'

function text(value: unknown, maximum: number, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : fallback
}

function names(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => text(item, 100)).filter(Boolean))).slice(0, 30)
}

function durationSeconds(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(15, parsed)) : 5
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const episodeId = text(body.episodeId, 191)
  const requestedStoryboardId = text(body.storyboardId, 191)
  const insertAfterPanelId = text(body.insertAfterPanelId, 191)
  const freeform = body.freeform === true || body.mode === 'freeform'
  const scriptHeading = text(body.scriptHeading, 500, freeform ? '自由创作 Segment' : '手动 Segment')
  const scriptText = text(body.scriptText, 200_000)
  const description = text(body.description, 200_000) || scriptText
  const location = text(body.location, 2_000, freeform ? '自由创作' : '未命名场景')
  const shotType = text(body.shotType, 500, freeform ? '' : '中景')
  const cameraMove = text(body.cameraMove, 1_000, freeform ? '' : '固定镜头')
  const videoPrompt = text(body.videoPrompt, 500_000)
  const imagePrompt = text(body.imagePrompt, 200_000)
  const characterNames = names(body.characters)
  const propNames = names(body.props)
  const duration = durationSeconds(body.duration)

  if (!episodeId || (!freeform && !scriptText)) {
    throw new ApiError('INVALID_PARAMS', { message: freeform ? '分集为必填项。' : '分集和剧本原文为必填项。' })
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!episode) throw new ApiError('NOT_FOUND', { message: '目标分集不存在。' })

  const panel = await prisma.$transaction(async (tx) => {
    let storyboard = requestedStoryboardId
      ? await tx.novelPromotionStoryboard.findFirst({
          where: { id: requestedStoryboardId, episodeId: episode.id },
          select: { id: true, clipId: true },
        })
      : null

    if (requestedStoryboardId && !storyboard) {
      throw new ApiError('NOT_FOUND', { message: '目标场景不存在。' })
    }

    if (!storyboard) {
      const clipCount = await tx.novelPromotionClip.count({ where: { episodeId: episode.id } })
      const clip = await tx.novelPromotionClip.create({
        data: {
          episodeId: episode.id,
          start: clipCount,
          end: clipCount + 1,
          duration: Math.round(duration),
          summary: scriptHeading,
          location,
          content: scriptText,
          characters: JSON.stringify(characterNames),
          props: JSON.stringify(propNames),
          startText: scriptHeading,
          endText: description.slice(0, 20_000),
          shotCount: 1,
          screenplay: JSON.stringify({ source: 'manual-segment', title: scriptHeading, description }),
        },
      })
      storyboard = await tx.novelPromotionStoryboard.create({
        data: {
          episodeId: episode.id,
          clipId: clip.id,
          panelCount: 0,
          storyboardTextJson: JSON.stringify({ source: 'manual-segment', location }),
        },
        select: { id: true, clipId: true },
      })
    }

    let panelIndex = 0
    if (insertAfterPanelId) {
      const anchor = await tx.novelPromotionPanel.findFirst({
        where: { id: insertAfterPanelId, storyboardId: storyboard.id },
        select: { panelIndex: true },
      })
      if (!anchor) throw new ApiError('NOT_FOUND', { message: '插入位置不存在。' })
      panelIndex = anchor.panelIndex + 1
      const maximum = await tx.novelPromotionPanel.findFirst({
        where: { storyboardId: storyboard.id },
        orderBy: { panelIndex: 'desc' },
        select: { panelIndex: true },
      })
      const offset = (maximum?.panelIndex ?? 0) + 1_000
      await tx.novelPromotionPanel.updateMany({
        where: { storyboardId: storyboard.id, panelIndex: { gt: anchor.panelIndex } },
        data: { panelIndex: { increment: offset }, panelNumber: { increment: offset } },
      })
      await tx.novelPromotionPanel.updateMany({
        where: { storyboardId: storyboard.id, panelIndex: { gt: anchor.panelIndex + offset } },
        data: { panelIndex: { decrement: offset - 1 }, panelNumber: { decrement: offset - 1 } },
      })
    } else {
      const maximum = await tx.novelPromotionPanel.findFirst({
        where: { storyboardId: storyboard.id },
        orderBy: { panelIndex: 'desc' },
        select: { panelIndex: true },
      })
      panelIndex = (maximum?.panelIndex ?? -1) + 1
    }

    const created = await tx.novelPromotionPanel.create({
      data: {
        storyboardId: storyboard.id,
        panelIndex,
        panelNumber: panelIndex + 1,
        shotType: shotType || null,
        cameraMove: cameraMove || null,
        description: description || null,
        location,
        characters: JSON.stringify(characterNames),
        props: JSON.stringify(propNames),
        srtSegment: scriptText,
        duration,
        videoPrompt: videoPrompt || null,
        imagePrompt: imagePrompt || null,
        sceneType: freeform ? 'manual-freeform' : 'manual',
      },
    })
    const panelCount = await tx.novelPromotionPanel.count({ where: { storyboardId: storyboard.id } })
    await Promise.all([
      tx.novelPromotionStoryboard.update({ where: { id: storyboard.id }, data: { panelCount } }),
      tx.novelPromotionClip.update({ where: { id: storyboard.clipId }, data: { shotCount: panelCount } }),
    ])
    return created
  }, { timeout: 30_000 })

  await syncProjectAssignmentsForProject({
    projectId,
    workspaceOwnerId: authResult.session.user.id,
  })

  return NextResponse.json({ success: true, panel })
})
