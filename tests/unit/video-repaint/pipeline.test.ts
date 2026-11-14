import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The 转绘 as the workbench drives it: one video goes through the real understand route, the real Ark layer and (when it
 * is installed) the real ffmpeg probe, in the same calls the browser makes — the source script first, then the storyboard
 * in as many rounds as the reply needs. Only what would cost money or leave the machine is replaced: Ark answers from a
 * script, and the account, billing and usage layers are stubs. The unit suites prove each layer on its own; this one
 * proves they agree with each other.
 */

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const billingMock = vi.hoisted(() => ({
  withTextBilling: vi.fn(),
}))
const usageMock = vi.hoisted(() => ({
  recordTextUsage: vi.fn(),
}))
const serviceUsageMock = vi.hoisted(() => ({
  recordServiceUsage: vi.fn(async () => undefined),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/billing/runtime-usage', () => usageMock)
vi.mock('@/lib/platform-services/usage', () => serviceUsageMock)

import { verifyVideoRepaintFileHandle } from '@/lib/video-repaint/file-handle'
import { formatTimecode } from '@/lib/video-repaint/storyboard-text'
import {
  getSourceStoryboardSystemPrompt,
  getVideoUnderstandingSystemPrompt,
} from '@/lib/volcengine/video-understanding'
import { VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION } from '@/lib/volcengine/video-understanding-contract'

const FFMPEG = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH?.trim() || 'ffprobe'
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0 && spawnSync(FFPROBE, ['-version']).status === 0

const ARK = 'https://ark.cn-beijing.volces.com/api/v3'
const API_KEY = 'server-only-pipeline-key'
const MODEL = 'pipeline-ark-model'
const FILE_ID = 'file-pipeline-provider-id'
const NO_CUT_SCAN_WARNING = '没能自动检测画面切点，分镜的镜头边界只依据视频理解，保存前请抽查时间码'
const USAGE = { input_tokens: 120, output_tokens: 30 }
const session = { user: { id: 'user-1', actorId: 'actor-1' } }
const ROUTE_CONTEXT = { params: Promise.resolve({}) }

const ENV_KEYS = [
  'ARK_API_KEY',
  'ARK_VIDEO_UNDERSTANDING_MODEL',
  'ARK_VIDEO_UNDERSTANDING_FPS',
  'VIDEO_REPAINT_FILE_HANDLE_SECRET',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

// --- what the video model "answers" -----------------------------------------------------------------------------------

function sourceAnalysis() {
  return {
    schema_version: VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION,
    analysis_mode: 'board',
    series_metadata: {},
    source_episode: {
      episode_number: 1,
      duration_seconds: 20,
      formatted_text: '第1集\n1-1\n场景：堂屋客厅 - 日 - 内\n人物：母亲、儿子\n△母亲坐在桌前，低头不语。\n母亲（低声）：你回来了。\n△儿子推门进来。\n儿子（哽咽）：妈，对不起。',
      scenes: [{
        scene_id: 'E01-S01',
        scene_number: '1-1',
        heading: { location: '堂屋客厅', time_of_day: '日', light_condition: '内' },
        source_range: { start_time: '00:00:00.000', end_time: '00:00:20.000' },
        character_refs: ['character_1', 'character_2'],
        beats: [
          { beat_id: 'E01-S01-B01', type: 'stage_direction', start_time: '00:00:01.000', end_time: '00:00:04.000', text: '母亲坐在桌前，低头不语。' },
          { beat_id: 'E01-S01-B02', type: 'dialogue', start_time: '00:00:06.000', end_time: '00:00:09.000', speaker_ref: 'character_1', parenthetical: '低声', text: '你回来了。' },
          { beat_id: 'E01-S01-B03', type: 'dialogue', start_time: '00:00:16.000', end_time: '00:00:19.000', speaker_ref: 'character_2', parenthetical: '哽咽', text: '妈，对不起。' },
        ],
      }],
    },
    asset_candidates: {
      characters: [
        { asset_ref: 'character_1', name_if_heard: '母亲', visual_identity: '中年女性，盘发', wardrobe: '深蓝布衫' },
        { asset_ref: 'character_2', name_if_heard: '儿子', visual_identity: '青年男子，短发', wardrobe: '灰色卫衣' },
      ],
      locations: [{ asset_ref: 'location_1', name_if_known: '堂屋客厅', layout: '八仙桌居中' }],
      props: [{ asset_ref: 'prop_1', name_if_known: '台灯', appearance: '黄铜底座' }],
    },
    adaptation_contract: {
      story_invariants: [],
      character_function_invariants: [],
      relationship_invariants: [],
      causal_chain: [],
      hook_map: [],
      localization_candidates: [],
      do_not_localize: [],
      cultural_risks: [],
    },
    quality_report: {},
  }
}

const OPENING = [
  '## S1 [堂屋客厅 · 日间 · 内] 角色：母亲 / 儿子',
  '造型：母亲=中年、盘发、深蓝布衫；儿子=青年、短发、灰色卫衣',
].join('\n')

function shotBlock(number: number, start: string, end: string, extra: string[] = []): string {
  return [
    `### SH${String(number).padStart(3, '0')} [${start}-${end}]`,
    '镜头：中景，平视，固定镜头，标准 50mm，浅景深焦在人物，常速，三脚架固定。镜头从桌面起，中段不变，落点在人物脸上。',
    '画面：母亲坐在桌前，左侧是亮着的台灯。',
    '表情动作：低头不语——压抑的沉默',
    '光影：台灯暖光，侧光，背景偏暗。',
    ...extra,
  ].join('\n')
}

const MOTHER_LINE = '母亲 (对口型·低声)：{你回来了。}'
const SON_LINE = '儿子 (对口型·哽咽)：{妈，对不起。}'

// The model's first reply stops in the middle of SH003, and its shot boundaries sit a little off the real cuts.
const ROUND_ONE = [
  OPENING,
  shotBlock(1, '00:00.0', '00:04.8'),
  shotBlock(2, '00:05.1', '00:09.8', [MOTHER_LINE]),
  ['### SH003 [00:09.9-00:12.0]', '镜头：中景，平视，固'].join('\n'),
].join('\n\n')

// The second reply carries on inside the same scene (no heading) and ends a shade before the end of the video.
const ROUND_TWO = [
  shotBlock(3, '00:09.9', '00:15.2'),
  shotBlock(4, '00:15.2', '00:19.7', [SON_LINE]),
].join('\n\n')

// Without cut hints there is nothing to line up with, so one round that fits is enough.
const SINGLE_ROUND = [
  OPENING,
  shotBlock(1, '00:00.0', '00:06.0'),
  shotBlock(2, '00:06.0', '00:12.4', [MOTHER_LINE]),
  shotBlock(3, '00:12.4', '00:19.8', [SON_LINE]),
].join('\n\n')

// --- the Ark stand-in -------------------------------------------------------------------------------------------------

interface ResponsesBody {
  model: string
  max_output_tokens: number
  stream: boolean
  thinking: { type: string }
  instructions: string
  input: Array<{ role: string; content: Array<{ type: string; file_id?: string; text?: string }> }>
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A reply as Ark streams it: text deltas, then the closing event unless the connection is made to drop. */
function streamed(deltas: string[], ending: 'completed' | 'cut-off' = 'completed'): () => Response {
  return () => {
    const events: unknown[] = deltas.map((delta) => ({ type: 'response.output_text.delta', delta }))
    if (ending === 'completed') events.push({ type: 'response.completed', response: { status: 'completed', usage: USAGE } })
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }
}

function halves(text: string): string[] {
  const middle = Math.floor(text.length / 2)
  return [text.slice(0, middle), text.slice(middle)]
}

/** Installs the stand-in as the global fetch; everything Ark would have been sent is kept for inspection. */
function installArk(...replies: Array<() => Response>) {
  const state = {
    uploads: [] as FormData[],
    requests: [] as ResponsesBody[],
    authorizations: [] as Array<string | null>,
    strays: [] as string[],
    replies,
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    state.authorizations.push(new Headers(init?.headers).get('authorization'))
    if (method === 'POST' && url === `${ARK}/files`) {
      state.uploads.push(init?.body as FormData)
      return json({ id: FILE_ID, status: 'processed' })
    }
    if (method === 'POST' && url === `${ARK}/responses`) {
      state.requests.push(JSON.parse(String(init?.body)) as ResponsesBody)
      const reply = state.replies.shift()
      return reply ? reply() : json({ error: { message: 'no reply was scripted for this request' } }, 400)
    }
    state.strays.push(`${method} ${url}`)
    return json({ error: { message: 'unexpected request' } }, 404)
  }))
  return state
}

// --- the browser's side -----------------------------------------------------------------------------------------------

interface Validation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

interface UnderstoodVideo {
  fileHandle: string
  script: string
  analysis: Record<string, unknown>
  durationSeconds: number
  cutHints: number[]
  usage: { inputTokens: number; outputTokens: number }
  validation: Validation
}

interface StoryboardRound {
  fileHandle: string
  storyboard: string
  complete: boolean
  coveredSeconds: number
  durationSeconds: number
  shotCount: number
  addedShots: number
  usage: { inputTokens: number; outputTokens: number }
  validation: Validation
}

interface SseEvent {
  event: string
  data: Record<string, unknown>
}

function uploadRequest(file: File, options: { durationSeconds?: string; stream?: boolean } = {}) {
  const form = new FormData()
  form.set('file', file)
  form.set('mode', 'board')
  form.set('episodeNumber', '1')
  if (options.durationSeconds) form.set('durationSeconds', options.durationSeconds)
  return new NextRequest('http://localhost/api/video-repaint/understand', {
    method: 'POST',
    headers: options.stream === false ? undefined : { Accept: 'text/event-stream' },
    body: form,
  })
}

function storyboardRequest(payload: Record<string, unknown>, options: { stream?: boolean } = {}) {
  return new NextRequest('http://localhost/api/video-repaint/understand', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.stream === false ? {} : { Accept: 'text/event-stream' }),
    },
    body: JSON.stringify({ stage: 'storyboard', episodeNumber: 1, ...payload }),
  })
}

async function readStream(response: Response): Promise<SseEvent[]> {
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  return (await response.text()).split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n')
    return {
      event: lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '',
      data: JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}') as Record<string, unknown>,
    }
  })
}

function resultOf<T>(events: SseEvent[]): T {
  expect(events.filter((event) => event.event === 'error')).toEqual([])
  const result = events.find((event) => event.event === 'result')
  expect(result).toBeDefined()
  return (result?.data.result ?? null) as T
}

function stagesOf(events: SseEvent[]): string[] {
  return [...new Set(events.filter((event) => event.event === 'progress').map((event) => String(event.data.stage)))]
}

function promptOf(request: ResponsesBody): string {
  return request.input[0].content[1].text ?? ''
}

function probeWorkspaces(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('nori-repaint-')).sort()
}

async function loadRoute() {
  return await import('@/app/api/video-repaint/understand/route')
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ARK_API_KEY = API_KEY
  process.env.ARK_VIDEO_UNDERSTANDING_MODEL = MODEL
  process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET = 'pipeline-handle-secret'
  delete process.env.ARK_VIDEO_UNDERSTANDING_FPS
  authMock.requireUserAuth.mockResolvedValue({ session })
  billingMock.withTextBilling.mockImplementation(async (...args: unknown[]) => {
    const generate = args[5] as () => Promise<unknown>
    return await generate()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.skipIf(!hasFfmpeg)('video repaint pipeline with a real video', () => {
  let directory = ''
  let fourShots: Uint8Array<ArrayBuffer>

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'nori-pipeline-fixture-'))
    // Four colour blocks of five seconds: the picture cuts at 5, 10 and 15 seconds.
    const colours = ['red', 'blue', 'green', 'white']
    const file = path.join(directory, 'four-shots.mp4')
    const result = spawnSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...colours.flatMap((colour) => ['-f', 'lavfi', '-i', `color=c=${colour}:s=160x120:r=25:d=5`]),
      '-filter_complex', `${colours.map((_, index) => `[${index}:v]`).join('')}concat=n=${colours.length}:v=1:a=0[v]`,
      '-map', '[v]', '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p',
      file,
    ])
    if (result.status !== 0) throw new Error(`ffmpeg could not render the fixture: ${result.stderr?.toString()}`)
    fourShots = new Uint8Array(readFileSync(file))
    return () => rmSync(directory, { recursive: true, force: true })
  }, 60_000)

  it('turns one upload into a complete storyboard whose shot boundaries sit on the real cuts', async () => {
    const before = probeWorkspaces()
    const ark = installArk(
      streamed(halves(JSON.stringify(sourceAnalysis()))),
      streamed([ROUND_ONE], 'cut-off'),
      streamed([ROUND_TWO]),
    )
    const { POST } = await loadRoute()

    // 1. The upload: ffmpeg measures the video while Ark reads it.
    const uploadEvents = await readStream(await POST(
      uploadRequest(new File([fourShots], 'pipeline.mp4', { type: 'video/mp4' })) as never,
      ROUTE_CONTEXT,
    ))
    expect(stagesOf(uploadEvents)).toEqual(['upload', 'preprocess', 'analyze'])
    const understood = resultOf<UnderstoodVideo>(uploadEvents)

    expect(understood.durationSeconds).toBeGreaterThan(19.9)
    expect(understood.durationSeconds).toBeLessThan(20.3)
    expect(understood.cutHints).toHaveLength(3)
    ;[5, 10, 15].forEach((expected, index) => {
      expect(Math.abs(understood.cutHints[index] - expected)).toBeLessThan(0.15)
    })
    expect(understood.validation).toMatchObject({ valid: true, errors: [] })
    expect(understood.script).toContain('母亲（低声）：你回来了。')
    expect(understood.analysis).toMatchObject({ source_episode: { duration_seconds: 20 } })
    expect(verifyVideoRepaintFileHandle(understood.fileHandle, 'actor-1')).toMatchObject({
      fileId: FILE_ID,
      episodeNumber: 1,
      durationSeconds: understood.durationSeconds,
    })
    expect(verifyVideoRepaintFileHandle(understood.fileHandle, 'someone-else')).toBeNull()
    // The temporary copy ffmpeg worked on is gone by the time the answer is out.
    expect(probeWorkspaces()).toEqual(before)

    // What went to Ark: the video itself, at a sampling rate chosen for its length, and the measured length in the prompt.
    expect(ark.uploads).toHaveLength(1)
    const uploaded = ark.uploads[0].get('file') as File
    expect(uploaded.name).toBe('pipeline.mp4')
    expect(uploaded.size).toBe(fourShots.byteLength)
    expect(ark.uploads[0].get('purpose')).toBe('user_data')
    expect(ark.uploads[0].get('preprocess_configs[video][fps]')).toBe('2')

    const analysisRequest = ark.requests[0]
    expect(analysisRequest.model).toBe(MODEL)
    expect(analysisRequest.stream).toBe(true)
    expect(analysisRequest.thinking).toEqual({ type: 'disabled' })
    expect(analysisRequest.max_output_tokens).toBeGreaterThan(8_000)
    expect(analysisRequest.instructions).toBe(getVideoUnderstandingSystemPrompt())
    expect(analysisRequest.input[0].content[0]).toEqual({ type: 'input_video', file_id: FILE_ID })
    const pinned = /视频精确时长：(\d+\.\d{3}) 秒/.exec(promptOf(analysisRequest))
    expect(pinned).not.toBeNull()
    expect(Math.abs(Number(pinned?.[1]) - understood.durationSeconds)).toBeLessThan(0.001)

    // 2. Storyboard round one: the model stops in the middle of SH003, so only the finished shots are kept, and the
    //    boundary between them moves onto the detected cut.
    const roundOneEvents = await readStream(await POST(
      storyboardRequest({
        fileHandle: understood.fileHandle,
        sourceAnalysis: understood.analysis,
        cutHints: understood.cutHints,
      }) as never,
      ROUTE_CONTEXT,
    ))
    expect(stagesOf(roundOneEvents)).toContain('storyboard')
    const roundOne = resultOf<StoryboardRound>(roundOneEvents)
    const firstCut = formatTimecode(understood.cutHints[0])

    expect(roundOne).toMatchObject({ complete: false, shotCount: 2, addedShots: 2 })
    expect(roundOne.coveredSeconds).toBeCloseTo(9.8, 5)
    expect(roundOne.durationSeconds).toBe(understood.durationSeconds)
    expect(roundOne.storyboard).toContain(`### SH001 [00:00.0-${firstCut}]`)
    expect(roundOne.storyboard).toContain(`### SH002 [${firstCut}-00:09.8]`)
    expect(roundOne.storyboard).not.toContain('SH003')
    expect(roundOne.storyboard).toContain(MOTHER_LINE)

    const roundOneRequest = ark.requests[1]
    expect(roundOneRequest.instructions).toBe(getSourceStoryboardSystemPrompt())
    // The file id comes out of the signed handle, never from the browser.
    expect(roundOneRequest.input[0].content[0]).toEqual({ type: 'input_video', file_id: FILE_ID })
    const roundOnePrompt = promptOf(roundOneRequest)
    expect(roundOnePrompt).toContain(`精确时长 ${understood.durationSeconds.toFixed(3)} 秒（${formatTimecode(understood.durationSeconds)}）`)
    expect(roundOnePrompt).toContain('第一镜从 00:00.0 起')
    expect(roundOnePrompt).toContain('机器检测的切点（3 个')
    for (const cut of understood.cutHints) expect(roundOnePrompt).toContain(formatTimecode(cut))
    // The labels the storyboard uses are the ones the source script settled on.
    expect(roundOnePrompt).toContain('母亲')
    expect(roundOnePrompt).toContain('堂屋客厅')

    // 3. Round two carries on from where round one stopped and finishes the video.
    const roundTwo = resultOf<StoryboardRound>(await readStream(await POST(
      storyboardRequest({
        fileHandle: understood.fileHandle,
        sourceAnalysis: understood.analysis,
        cutHints: understood.cutHints,
        continuation: { storyboard: roundOne.storyboard },
      }) as never,
      ROUTE_CONTEXT,
    )))
    const secondCut = formatTimecode(understood.cutHints[1])
    const thirdCut = formatTimecode(understood.cutHints[2])
    const endOfVideo = formatTimecode(understood.durationSeconds)

    expect(roundTwo).toMatchObject({ complete: true, shotCount: 4, addedShots: 2 })
    expect(Math.abs(roundTwo.coveredSeconds - understood.durationSeconds)).toBeLessThan(0.1)
    expect(roundTwo.storyboard.match(/^## S\d+/gm)).toEqual(['## S1'])
    expect(roundTwo.storyboard.match(/^### SH\d+/gm)).toEqual(['### SH001', '### SH002', '### SH003', '### SH004'])
    // The seam between the rounds, the next boundary and the end of the video all land on real moments of the video.
    expect(roundTwo.storyboard).toContain(`### SH002 [${firstCut}-${secondCut}]`)
    expect(roundTwo.storyboard).toContain(`### SH003 [${secondCut}-${thirdCut}]`)
    expect(roundTwo.storyboard).toContain(`### SH004 [${thirdCut}-${endOfVideo}]`)
    expect(roundTwo.storyboard).toContain(MOTHER_LINE)
    expect(roundTwo.storyboard).toContain(SON_LINE)
    expect(roundTwo.validation).toEqual({ valid: true, errors: [], warnings: [] })

    const roundTwoPrompt = promptOf(ark.requests[2])
    expect(roundTwoPrompt).toContain('续写：上一轮分镜已经写到 00:09.8（共 2 镜，最后一镜是 SH002）')
    expect(roundTwoPrompt).toContain('编号从 SH003 起')
    expect(roundTwoPrompt).toContain('造型：母亲=中年、盘发、深蓝布衫')
    expect(roundTwoPrompt).toContain('上一轮已出现的角色称谓：母亲 / 儿子')
    // Only the cuts still ahead are listed.
    expect(roundTwoPrompt).toContain('机器检测的切点（2 个')

    // Everything was billed as it ran, and nothing but the three Ark calls (and the upload) left the machine.
    expect(billingMock.withTextBilling.mock.calls.map((call) => (call[4] as { action: string }).action)).toEqual([
      'video_repaint_understanding_board',
      'video_repaint_source_storyboard',
      'video_repaint_source_storyboard',
    ])
    expect(usageMock.recordTextUsage).toHaveBeenCalledTimes(3)
    expect(usageMock.recordTextUsage).toHaveBeenCalledWith({ model: `ark::${MODEL}`, inputTokens: 120, outputTokens: 30 })
    expect(ark.replies).toHaveLength(0)
    expect(ark.strays).toEqual([])
    expect(ark.authorizations.length).toBe(4)
    expect(ark.authorizations.every((value) => value === `Bearer ${API_KEY}`)).toBe(true)

    // Neither the key, nor the provider's file id, nor the model behind the service reach the browser.
    const everythingTheBrowserSaw = JSON.stringify([uploadEvents, roundOneEvents, roundTwo])
    for (const secret of [API_KEY, FILE_ID, MODEL]) expect(everythingTheBrowserSaw).not.toContain(secret)
  }, 60_000)
})

describe('video repaint pipeline without ffmpeg', () => {
  it('falls back to the length the browser measured and writes the storyboard without cut hints', async () => {
    process.env.FFMPEG_PATH = path.join(tmpdir(), 'no-such-dir', 'ffmpeg')
    process.env.FFPROBE_PATH = path.join(tmpdir(), 'no-such-dir', 'ffprobe')
    const before = probeWorkspaces()
    const ark = installArk(streamed([JSON.stringify(sourceAnalysis())]), streamed([SINGLE_ROUND]))
    const { POST } = await loadRoute()

    const upload = await POST(
      uploadRequest(new File([new Uint8Array(2_048)], 'clip.mp4', { type: 'video/mp4' }), { durationSeconds: '20', stream: false }) as never,
      ROUTE_CONTEXT,
    )
    expect(upload.status).toBe(200)
    const understood = (await upload.json() as { result: UnderstoodVideo }).result

    expect(understood.durationSeconds).toBe(20)
    expect(understood.cutHints).toEqual([])
    expect(understood.validation.warnings).toContain(NO_CUT_SCAN_WARNING)
    expect(ark.uploads[0].get('preprocess_configs[video][fps]')).toBe('2')
    expect(probeWorkspaces()).toEqual(before)

    const storyboard = await POST(
      storyboardRequest({
        fileHandle: understood.fileHandle,
        sourceAnalysis: understood.analysis,
        cutHints: understood.cutHints,
      }, { stream: false }) as never,
      ROUTE_CONTEXT,
    )
    expect(storyboard.status).toBe(200)
    const round = (await storyboard.json() as { result: StoryboardRound }).result

    expect(round).toMatchObject({ complete: true, shotCount: 3, addedShots: 3, durationSeconds: 20, coveredSeconds: 20 })
    expect(round.storyboard).toContain('### SH003 [00:12.4-00:20.0]')
    expect(round.validation).toEqual({ valid: true, errors: [], warnings: [] })
    expect(promptOf(ark.requests[1])).not.toContain('机器检测的切点')
    expect(ark.strays).toEqual([])
  }, 30_000)
})
