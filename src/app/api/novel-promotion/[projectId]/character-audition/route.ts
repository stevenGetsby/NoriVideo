import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveRuntimeModelKey } from '@/lib/nori-model-catalog'

function cleanText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function isSeedance2Model(modelKey: string) {
  const parsed = parseModelKeyStrict(resolveRuntimeModelKey(modelKey) || modelKey)
  return parsed?.provider === 'ark' && /^doubao-seedance-2-0(?:-|$)/.test(parsed.modelId)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const characterId = cleanText(new URL(request.url).searchParams.get('characterId'), 191)
  if (!characterId) throw new ApiError('INVALID_PARAMS', { message: '缺少角色 ID。' })

  const candidates = await prisma.frameosToolboxAsset.findMany({
    where: { projectId, type: 'video', bizType: 'character_audition', status: 'ready' },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  })
  const asset = candidates.find((candidate) => cleanText(record(candidate.params).characterId, 191) === characterId)
  if (!asset) return NextResponse.json({ success: true, audition: null })

  const task = await prisma.task.findFirst({
    where: {
      projectId,
      targetType: 'FrameosToolboxAsset',
      targetId: asset.id,
      type: TASK_TYPE.TOOLBOX_VIDEO,
      status: 'completed',
    },
    orderBy: { updatedAt: 'desc' },
    select: { result: true, updatedAt: true },
  })
  const result = record(task?.result)
  const audioUrl = cleanText(result.audioUrl, 2_000)
  return NextResponse.json({
    success: true,
    audition: {
      assetId: asset.id,
      videoUrl: cleanText(result.videoUrl, 2_000) || asset.resultUrl,
      audioUrl: audioUrl || null,
      updatedAt: (task?.updatedAt || asset.updatedAt).toISOString(),
    },
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const characterId = cleanText(body.characterId, 191)
  const prompt = cleanText(body.prompt, 20_000)
  const videoModel = cleanText(body.videoModel, 500)
  if (!characterId || !prompt || !videoModel || !isSeedance2Model(videoModel)) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择 Seedance 2.0 模型并填写试镜提示词。' })
  }

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: { id: characterId, novelPromotionProject: { projectId } },
    include: { appearances: { orderBy: { appearanceIndex: 'asc' }, take: 1 } },
  })
  const referenceImage = character?.appearances[0]?.imageUrl?.trim() || ''
  if (!character || !referenceImage) {
    throw new ApiError('INVALID_PARAMS', { message: '请先为该角色生成并选定角色设定图。' })
  }

  const asset = await prisma.frameosToolboxAsset.create({
    data: {
      userId: session.user.id,
      projectId,
      type: 'video',
      source: 'production',
      bizType: 'character_audition',
      modelId: videoModel,
      status: 'pending',
      params: { characterId, title: `${character.name} · Seedance 试镜`, prompt },
    },
  })

  const payload = {
    title: `${character.name} · Seedance 试镜`,
    prompt,
    // Explicit reference mode: the selected character image is always sent to
    // Seedance together with the short dialogue/audio prompt below.
    inputMode: 'reference',
    referenceImages: [referenceImage],
    referenceVideos: [],
    referenceAudios: [],
    referenceNames: [character.name],
    referenceImageNames: [character.name],
    referenceVideoNames: [],
    referenceAudioNames: [],
    referenceMaterialIds: [],
    referenceMaterials: [],
    referenceImageRoles: ['REF'],
    referenceSummary: [],
    videoModel,
    modelId: videoModel,
    duration: 5,
    resolution: '720p',
    generateAudio: true,
    generationOptions: {
      duration: 5,
      resolution: '720p',
      generateAudio: true,
      generationMode: 'normal',
    },
  }

  try {
    const submitted = await submitTask({
      userId: session.user.id,
      locale: resolveRequiredTaskLocale(request, body),
      requestId: getRequestId(request),
      projectId,
      type: TASK_TYPE.TOOLBOX_VIDEO,
      targetType: 'FrameosToolboxAsset',
      targetId: asset.id,
      payload,
      dedupeKey: `${TASK_TYPE.TOOLBOX_VIDEO}:${asset.id}`,
    })
    return NextResponse.json({ ...submitted, assetId: asset.id })
  } catch (error) {
    // Compensation: keep the created asset for auditability, but make the
    // failed submission explicit so it cannot remain pending indefinitely.
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: { status: 'failed', errorMessage: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined)
    throw error
  }
})
