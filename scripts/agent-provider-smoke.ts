import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

type SmokeStatus = 'pass' | 'fail' | 'skip'

type SmokeStep = {
  name: 'lumina_text' | 'hfsy_image' | 'ark_seedance_video'
  status: SmokeStatus
  model?: string
  message: string
  detail?: Record<string, unknown>
}

type SmokeReport = {
  ok: boolean
  createdAt: string
  steps: SmokeStep[]
}

function readEnv(name: string): string {
  return (process.env[name] || '').trim()
}

function redact(value: string): string {
  if (!value) return ''
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text.slice(0, 500)
  }
}

function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return typeof payload === 'string' ? payload : ''
  const record = payload as Record<string, unknown>
  const error = record.error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  const message = record.message
  return typeof message === 'string' ? message : ''
}

function extractAnthropicText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const content = (payload as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text
    }
    return ''
  }).join('').trim()
}

function extractImagePayload(payload: unknown): { imageDataUrl?: string; imageUrl?: string; kind: 'b64' | 'url' | 'none'; length?: number } {
  if (!payload || typeof payload !== 'object') return { kind: 'none' }
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return { kind: 'none' }
  const first = data[0]
  if (!first || typeof first !== 'object') return { kind: 'none' }
  const b64 = (first as { b64_json?: unknown }).b64_json
  if (typeof b64 === 'string' && b64.trim()) {
    const trimmed = b64.trim()
    return {
      imageDataUrl: `data:image/png;base64,${trimmed}`,
      kind: 'b64',
      length: trimmed.length,
    }
  }
  const url = (first as { url?: unknown }).url
  if (typeof url === 'string' && url.trim()) {
    return {
      imageUrl: url.trim(),
      kind: 'url',
      length: url.trim().length,
    }
  }
  return { kind: 'none' }
}

function extractArkVideoUrl(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const content = (payload as { content?: unknown }).content
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const direct = (content as { video_url?: unknown }).video_url
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      const direct = (item as { video_url?: unknown }).video_url
      if (typeof direct === 'string' && direct.trim()) return direct.trim()
      if (direct && typeof direct === 'object') {
        const nested = (direct as { url?: unknown }).url
        if (typeof nested === 'string' && nested.trim()) return nested.trim()
      }
    }
  }
  return ''
}

async function pollArkVideoTask(params: {
  apiKey: string
  taskId: string
  maxAttempts?: number
  intervalMs?: number
}): Promise<{ status: string; videoUrlPresent: boolean; attempts: number; error?: unknown }> {
  const maxAttempts = params.maxAttempts ?? 18
  const intervalMs = params.intervalMs ?? 20_000
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${params.taskId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${params.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    })
    const payload = await readJsonOrText(response)
    const status = payload && typeof payload === 'object'
      ? String((payload as { status?: unknown }).status || `HTTP ${response.status}`)
      : `HTTP ${response.status}`
    const videoUrl = extractArkVideoUrl(payload)
    if (videoUrl || status === 'failed' || !response.ok) {
      return {
        status,
        videoUrlPresent: !!videoUrl,
        attempts: attempt,
        error: payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : undefined,
      }
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  return {
    status: 'timeout',
    videoUrlPresent: false,
    attempts: maxAttempts,
  }
}

async function smokeLuminaText(): Promise<SmokeStep> {
  const apiKey = readEnv('NORI_TEST_LUMINA_API_KEY')
  const model = readEnv('NORI_TEST_LUMINA_MODEL') || 'gpt-5.5'
  if (!apiKey) {
    return {
      name: 'lumina_text',
      status: 'fail',
      model,
      message: 'NORI_TEST_LUMINA_API_KEY missing',
    }
  }

  const response = await fetch('https://lumina.tripo3d.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: 'Return exactly {"agent_smoke":true} and no other text.',
      }],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const payload = await readJsonOrText(response)
  if (!response.ok) {
    return {
      name: 'lumina_text',
      status: 'fail',
      model,
      message: `HTTP ${response.status}: ${readErrorMessage(payload) || 'Lumina text probe failed'}`,
      detail: { key: redact(apiKey), payload },
    }
  }

  const text = extractAnthropicText(payload)
  return {
    name: 'lumina_text',
    status: text ? 'pass' : 'fail',
    model,
    message: text ? `Response: ${text.slice(0, 120)}` : 'Lumina returned no text',
    ...(!text ? { detail: { payload } } : {}),
  }
}

async function smokeHfsyImage(): Promise<{ step: SmokeStep; imageInputUrl?: string }> {
  const apiKey = readEnv('NORI_TEST_IMAGE_API_KEY')
  const model = readEnv('NORI_TEST_IMAGE_MODEL') || 'gpt-image-2'
  if (!apiKey) {
    return {
      step: {
        name: 'hfsy_image',
        status: 'fail',
        model,
        message: 'NORI_TEST_IMAGE_API_KEY missing',
      },
    }
  }

  const response = await fetch('https://www.hfsyapi.cn/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: '9:16 storyboard still, a white test card with a small blue circle, clean composition',
      size: '1024x1024',
      n: 1,
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const payload = await readJsonOrText(response)
  if (!response.ok) {
    return {
      step: {
        name: 'hfsy_image',
        status: 'fail',
        model,
        message: `HTTP ${response.status}: ${readErrorMessage(payload) || 'HFSY image probe failed'}`,
        detail: { key: redact(apiKey), payload },
      },
    }
  }

  const imagePayload = extractImagePayload(payload)
  const imageInputUrl = imagePayload.imageDataUrl || imagePayload.imageUrl
  if (!imageInputUrl) {
    return {
      step: {
        name: 'hfsy_image',
        status: 'fail',
        model,
        message: 'HFSY returned no b64_json or URL image',
        detail: { payload },
      },
    }
  }
  return {
    step: {
      name: 'hfsy_image',
      status: 'pass',
      model,
      message: imagePayload.kind === 'b64'
        ? `Image b64 received (${imagePayload.length} chars)`
        : `Image URL received (${imagePayload.length} chars)`,
    },
    imageInputUrl,
  }
}

async function smokeArkSeedanceVideo(imageInputUrl?: string): Promise<SmokeStep> {
  const apiKey = readEnv('NORI_TEST_ARK_API_KEY')
  const model = readEnv('NORI_TEST_ARK_VIDEO_MODEL') || 'doubao-seedance-2-0-260128'
  if (!apiKey) {
    return {
      name: 'ark_seedance_video',
      status: 'fail',
      model,
      message: 'NORI_TEST_ARK_API_KEY missing',
    }
  }
  if (!imageInputUrl) {
    return {
      name: 'ark_seedance_video',
      status: 'skip',
      model,
      message: 'Skipped because image smoke did not produce an image input URL',
    }
  }

  const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      content: [
        {
          type: 'text',
          text: 'Generate a 4 second 9:16 video from this storyboard still. Static camera, no subtitles, no background music.',
        },
        {
          type: 'image_url',
          image_url: { url: imageInputUrl },
          role: 'reference_image',
        },
      ],
      resolution: '480p',
      ratio: '9:16',
      duration: 4,
      generate_audio: false,
      watermark: false,
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const payload = await readJsonOrText(response)
  if (!response.ok) {
    return {
      name: 'ark_seedance_video',
      status: 'fail',
      model,
      message: `HTTP ${response.status}: ${readErrorMessage(payload) || 'Ark Seedance task creation failed'}`,
      detail: { key: redact(apiKey), payload },
    }
  }

  const id = payload && typeof payload === 'object' ? (payload as { id?: unknown }).id : null
  if (typeof id === 'string' && id.trim() && readEnv('NORI_SMOKE_POLL_VIDEO') === 'true') {
    const pollResult = await pollArkVideoTask({
      apiKey,
      taskId: id,
    })
    return {
      name: 'ark_seedance_video',
      status: pollResult.videoUrlPresent ? 'pass' : 'fail',
      model,
      message: pollResult.videoUrlPresent
        ? `Seedance task completed with video_url: ${id}`
        : `Seedance task did not return video_url (${pollResult.status})`,
      detail: {
        taskId: id,
        poll: pollResult,
      },
    }
  }
  return {
    name: 'ark_seedance_video',
    status: typeof id === 'string' && id.trim() ? 'pass' : 'fail',
    model,
    message: typeof id === 'string' && id.trim()
      ? `Seedance task created: ${id}`
      : 'Ark returned no task id',
    detail: typeof id === 'string' && id.trim() ? { taskId: id } : { payload },
  }
}

async function main() {
  const steps: SmokeStep[] = []
  const luminaStep = await smokeLuminaText().catch((error) => ({
    name: 'lumina_text' as const,
    status: 'fail' as const,
    message: error instanceof Error ? error.message : String(error),
  }))
  steps.push(luminaStep)

  const imageResult = await smokeHfsyImage().catch((error) => ({
    step: {
      name: 'hfsy_image' as const,
      status: 'fail' as const,
      message: error instanceof Error ? error.message : String(error),
    },
  }))
  steps.push(imageResult.step)

  const videoStep = await smokeArkSeedanceVideo(imageResult.imageInputUrl).catch((error) => ({
    name: 'ark_seedance_video' as const,
    status: 'fail' as const,
    message: error instanceof Error ? error.message : String(error),
  }))
  steps.push(videoStep)

  const report: SmokeReport = {
    ok: steps.every((step) => step.status === 'pass'),
    createdAt: new Date().toISOString(),
    steps,
  }

  const reportPath = path.join(process.cwd(), '.runtime', 'agent-provider-smoke-report.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

void main()
