import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { getProviderConfig } from '@/lib/api-config'
import { getCompletionContent } from '@/lib/llm-client'
import { runModelGatewayTextCompletion } from '@/lib/model-gateway/llm'
import { generateImage, generateVideo } from '@/lib/generator-api'
import { pollAsyncTask } from '@/lib/async-poll'
import { readMaterializedPlatformServiceConfig } from '@/lib/platform-services/config'
import {
  adaptVideoScriptWithArk,
  getVideoScriptAdaptationModel,
} from '@/lib/volcengine/video-script-adaptation'
import {
  getArkVideoUnderstandingConfig,
  understandVideoWithArk,
} from '@/lib/volcengine/video-understanding'

type GenerationType = 'llm' | 'image' | 'video'

type RoutedModel = {
  type: GenerationType
  businessModel: string
  runtimeModel: string
}

type Step = {
  name: GenerationType | 'video-repaint'
  businessModel: string
  runtimeModel: string
  status: 'pass' | 'fail'
  elapsedMs: number
  message: string
}

const POLL_INTERVAL_MS = 5_000
const MEDIA_TIMEOUT_MS = 30 * 60_000

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

function configuredGenerationModels(): RoutedModel[] {
  const config = readMaterializedPlatformServiceConfig()
  const models = config.llm?.models || []
  const modelTypes = new Map(models.map((model) => [model.modelKey, model.type]))
  const unique = new Map<string, RoutedModel>()
  for (const [businessModel, runtimeModel] of Object.entries(config.llm?.modelRouting || {})) {
    const type = modelTypes.get(runtimeModel)
    if (type !== 'llm' && type !== 'image' && type !== 'video') continue
    if (!unique.has(runtimeModel)) unique.set(runtimeModel, { type, businessModel, runtimeModel })
  }
  return Array.from(unique.values())
}

async function pollMedia(externalId: string, userId: string) {
  const deadline = Date.now() + MEDIA_TIMEOUT_MS
  let transientFailures = 0
  while (Date.now() < deadline) {
    try {
      const result = await pollAsyncTask(externalId, userId)
      transientFailures = 0
      if (result.status !== 'pending') return result
    } catch (error) {
      transientFailures += 1
      if (transientFailures >= 12) throw error
      process.stdout.write(`[production-smoke] transient poll failure ${transientFailures}/12 for ${externalId}\n`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return { status: 'failed' as const, error: 'media polling timed out' }
}

async function assertDownloadable(url: string, kind: string) {
  const response = await fetch(url, {
    headers: { Range: 'bytes=0-1023' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok && response.status !== 206) {
    throw new Error(`${kind} result HTTP ${response.status}`)
  }
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length === 0) throw new Error(`${kind} result is empty`)
}

async function resolveImageUrl(result: Awaited<ReturnType<typeof generateImage>>, userId: string) {
  if (!result.success) throw new Error(result.error || 'image submission failed')
  const directUrl = result.imageUrl || result.imageUrls?.[0]
  if (directUrl) return directUrl
  if (!result.externalId) throw new Error('image submission missing result URL and externalId')
  const completed = await pollMedia(result.externalId, userId)
  if (completed.status !== 'completed' || !completed.imageUrl) {
    throw new Error(completed.error || 'image generation did not complete')
  }
  return completed.imageUrl
}

async function resolveVideoUrl(result: Awaited<ReturnType<typeof generateVideo>>, userId: string) {
  if (!result.success) throw new Error(result.error || 'video submission failed')
  if (result.videoUrl) return result.videoUrl
  if (!result.externalId) throw new Error('video submission missing result URL and externalId')
  const completed = await pollMedia(result.externalId, userId)
  if (completed.status !== 'completed' || !completed.videoUrl) {
    throw new Error(completed.error || 'video generation did not complete')
  }
  return completed.videoUrl
}

async function runStep(
  name: Step['name'],
  businessModel: string,
  runtimeModel: string,
  execute: () => Promise<string>,
): Promise<{ step: Step; output?: string }> {
  const startedAt = Date.now()
  try {
    const output = await execute()
    const step: Step = {
      name,
      businessModel,
      runtimeModel,
      status: 'pass',
      elapsedMs: Date.now() - startedAt,
      message: 'completed',
    }
    process.stdout.write(`[production-smoke] PASS ${name} ${businessModel} -> ${runtimeModel} ${step.elapsedMs}ms\n`)
    return { step, output }
  } catch (error) {
    const step: Step = {
      name,
      businessModel,
      runtimeModel,
      status: 'fail',
      elapsedMs: Date.now() - startedAt,
      message: errorMessage(error),
    }
    process.stdout.write(`[production-smoke] FAIL ${name} ${businessModel} -> ${runtimeModel}: ${step.message}\n`)
    return { step }
  }
}

async function main() {
  process.env.LLM_RUNTIME_MODE = 'configured'
  const email = (process.env.NORI_SMOKE_USER_EMAIL || 'admin@caoshuang').trim()
  const requestedUser = await prisma.user.findFirst({
    where: { email, status: 'active' },
    select: { id: true },
  })
  const user = requestedUser || await prisma.user.findFirst({
    where: { status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!user) throw new Error(`smoke user not found: ${email}`)

  const routedModels = configuredGenerationModels()
  if (routedModels.length === 0) throw new Error('no configured generation models found')
  const skipVideoRepaint = process.env.NORI_SMOKE_SKIP_VIDEO_REPAINT === '1'
  const steps: Step[] = []
  let firstImageUrl = ''
  let firstVideoUrl = ''

  for (const model of routedModels.filter((item) => item.type === 'llm')) {
    const result = await runStep('llm', model.businessModel, model.runtimeModel, async () => {
      const completion = await runModelGatewayTextCompletion({
        userId: user.id,
        model: model.businessModel,
        messages: [{ role: 'user', content: '请只回复：NORI_OK' }],
        options: {
          maxTokens: 64,
          temperature: 0,
          projectId: 'production-model-live-smoke',
          action: 'production_model_live_smoke',
        },
      })
      const content = getCompletionContent(completion).trim()
      if (!content) throw new Error('text response is empty')
      return content
    })
    steps.push(result.step)
  }

  for (const model of routedModels.filter((item) => item.type === 'image')) {
    const result = await runStep('image', model.businessModel, model.runtimeModel, async () => {
      const submitted = await generateImage(
        user.id,
        model.businessModel,
        'A simple glowing blue cube centered on a clean white studio background, no text',
        { aspectRatio: '1:1' },
      )
      const imageUrl = await resolveImageUrl(submitted, user.id)
      await assertDownloadable(imageUrl, 'image')
      return imageUrl
    })
    steps.push(result.step)
    if (!firstImageUrl && result.output) firstImageUrl = result.output
  }

  if (!firstImageUrl) {
    process.stdout.write('[production-smoke] video steps will fail because no configured image model produced a source image\n')
  }

  for (const model of routedModels.filter((item) => item.type === 'video')) {
    const result = await runStep('video', model.businessModel, model.runtimeModel, async () => {
      if (!firstImageUrl) throw new Error('no source image available')
      const submitted = await generateVideo(
        user.id,
        model.businessModel,
        firstImageUrl,
        {
          prompt: 'The glowing blue cube rotates slowly in a clean white studio, static camera, no text, no subtitles',
          duration: 4,
          resolution: '480p',
          aspectRatio: '1:1',
          generateAudio: false,
          watermark: false,
        },
      )
      const videoUrl = await resolveVideoUrl(submitted, user.id)
      await assertDownloadable(videoUrl, 'video')
      return videoUrl
    })
    steps.push(result.step)
    if (!firstVideoUrl && result.output) firstVideoUrl = result.output
  }

  if (!skipVideoRepaint) {
    const understanding = getArkVideoUnderstandingConfig()
    const adaptationModel = getVideoScriptAdaptationModel()
    const repaint = await runStep(
      'video-repaint',
      `ark::${understanding.model}`,
      `ark::${adaptationModel}`,
      async () => {
        if (!firstVideoUrl) throw new Error('no production video output available')
        const ark = await getProviderConfig(user.id, 'ark')
        const response = await fetch(firstVideoUrl, { signal: AbortSignal.timeout(120_000) })
        if (!response.ok) throw new Error(`video download HTTP ${response.status}`)
        const body = Buffer.from(await response.arrayBuffer())
        if (body.length === 0) throw new Error('video body is empty')
        const understood = await understandVideoWithArk({
          apiKey: ark.apiKey,
          file: new File([new Uint8Array(body)], 'production-smoke.mp4', { type: 'video/mp4' }),
          mode: 'script',
          episodeNumber: 1,
        })
        if (!understood.episodeScript.trim() || understood.usage.inputTokens <= 0) {
          throw new Error('video understanding returned no script or usage')
        }
        const adapted = await adaptVideoScriptWithArk({
          apiKey: ark.apiKey,
          sourceScript: understood.episodeScript,
          adaptationBrief: '保持剧情不变，表达更简洁。',
          title: 'NoriVideo production smoke',
          model: adaptationModel,
        })
        if (adapted.mode !== 'llm' || !adapted.script.trim() || adapted.usage.inputTokens <= 0) {
          throw new Error('video adaptation returned no script or usage')
        }
        return 'completed'
      },
    )
    steps.push(repaint.step)
  }

  const reportDir = path.resolve(process.cwd(), '.runtime')
  fs.mkdirSync(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, 'production-models-live-smoke.json')
  const report = {
    ok: steps.every((step) => step.status === 'pass'),
    createdAt: new Date().toISOString(),
    configuredModels: routedModels,
    skipped: skipVideoRepaint ? ['video-repaint'] : [],
    unconfiguredTypes: {
      audio: readMaterializedPlatformServiceConfig().llm?.modelRouting?.['nori::nori-audio']
        ? []
        : ['nori::nori-audio'],
    },
    steps,
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`[production-smoke] report=${reportPath}\n`)
  process.stdout.write(`[production-smoke] summary pass=${steps.filter((step) => step.status === 'pass').length} fail=${steps.filter((step) => step.status === 'fail').length}\n`)
  await prisma.$disconnect()
  process.exit(report.ok ? 0 : 1)
}

main().catch(async (error) => {
  process.stderr.write(`[production-smoke] fatal=${errorMessage(error)}\n`)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
