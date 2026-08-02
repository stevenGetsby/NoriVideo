import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSourceStoryboardPrompt,
  buildVideoUnderstandingPrompt,
  getArkVideoUnderstandingConfig,
  getSourceStoryboardSystemPrompt,
  getVideoUnderstandingSystemPrompt,
  understandSourceStoryboardWithArk,
  understandVideoWithArk,
} from '@/lib/volcengine/video-understanding'
import {
  VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION,
  extractFormattedEpisodeScript,
  validateVideoRepaintAnalysis,
} from '@/lib/volcengine/video-understanding-contract'
import { formatSourceStoryboard } from '@/lib/volcengine/video-repaint-deliverables'
import { VIDEO_SOURCE_STORYBOARD_SCHEMA_VERSION } from '@/lib/volcengine/video-storyboard-contract'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sseResponse(outputText: string, usage = { input_tokens: 120, output_tokens: 30 }): Response {
  const events = [
    { type: 'response.output_text.delta', delta: outputText },
    { type: 'response.completed', response: { status: 'completed', usage } },
  ]
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function validAnalysis(mode: 'script' | 'board' = 'board') {
  return {
    schema_version: VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION,
    analysis_mode: mode,
    series_metadata: {},
    source_episode: {
      episode_number: 1,
      formatted_text: '第1集\n1-1\n场景：测试房间 - 夜 - 暗\n人物：测试人物\n△测试人物抬头。',
      scenes: [{
        scene_id: 'E01-S01',
        scene_number: '1-1',
        beats: [{
          beat_id: 'E01-S01-B01',
          type: 'stage_direction',
          text: '测试人物抬头。',
        }],
      }],
    },
    asset_candidates: {
      characters: [{ asset_ref: 'character_1', name_if_heard: '测试人物' }],
      locations: [{ asset_ref: 'location_1', name_if_known: '测试房间' }],
      props: [],
    },
    source_storyboard: {
      shots: [{
        panel_id: 'E01-P001',
        scene_id: 'E01-S01',
        source_anchor: {
          start_time: '00:00:00.000',
          end_time: '00:00:01.000',
        },
        source_beat_ids: ['E01-S01-B01'],
        referenced_assets: {
          characters: ['character_1'],
          location: 'location_1',
          props: [],
        },
      }],
      excluded_ranges: [],
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

describe('Ark video understanding', () => {
  const originalModel = process.env.ARK_VIDEO_UNDERSTANDING_MODEL
  const originalFps = process.env.ARK_VIDEO_UNDERSTANDING_FPS

  afterEach(() => {
    if (originalModel === undefined) delete process.env.ARK_VIDEO_UNDERSTANDING_MODEL
    else process.env.ARK_VIDEO_UNDERSTANDING_MODEL = originalModel
    if (originalFps === undefined) delete process.env.ARK_VIDEO_UNDERSTANDING_FPS
    else process.env.ARK_VIDEO_UNDERSTANDING_FPS = originalFps
    vi.restoreAllMocks()
  })

  it('builds a production system prompt from the project screenplay convention', () => {
    const systemPrompt = getVideoUnderstandingSystemPrompt()
    expect(systemPrompt).toContain(VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION)
    expect(systemPrompt).toContain('第 N 集')
    expect(systemPrompt).toContain('场景：地点 - 时间 - 天气/明暗')
    expect(systemPrompt).toContain('镜头特写')
    expect(systemPrompt).toContain('stage_direction')
    expect(systemPrompt).toContain('voiceover')
    expect(systemPrompt).toContain('inner_monologue')
    expect(systemPrompt).toContain('adaptation_contract')
    expect(systemPrompt).toContain('不得擅自改英文名')
  })

  it('builds mode-specific task prompts with episode and adaptation metadata', () => {
    const scriptPrompt = buildVideoUnderstandingPrompt('script', {
      episodeNumber: 3,
      fileName: 'EP03.mp4',
      adaptationBrief: '改为北美现代都市语境',
    })
    const boardPrompt = buildVideoUnderstandingPrompt('board')

    expect(scriptPrompt).toContain('script 模式')
    expect(scriptPrompt).toContain('任务集号：3')
    expect(scriptPrompt).toContain('EP03.mp4')
    expect(scriptPrompt).toContain('改为北美现代都市语境')
    expect(boardPrompt).toContain('board 模式')
    expect(boardPrompt).toContain(VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION)
  })

  it('builds a compact second-stage storyboard prompt from confirmed source data', () => {
    expect(getSourceStoryboardSystemPrompt()).toContain(VIDEO_SOURCE_STORYBOARD_SCHEMA_VERSION)
    const prompt = buildSourceStoryboardPrompt(validAnalysis('script'), {
      episodeNumber: 1,
      durationSeconds: 120.52,
    })
    expect(prompt).toContain('120.520')
    expect(prompt).toContain('character_1')
    expect(prompt).toContain('仅输出 nori-source-storyboard-v1 JSON')
  })

  it('reads model and fps from server environment with safe fps fallback', () => {
    process.env.ARK_VIDEO_UNDERSTANDING_MODEL = 'custom-video-model'
    process.env.ARK_VIDEO_UNDERSTANDING_FPS = '0.75'
    expect(getArkVideoUnderstandingConfig()).toEqual({
      model: 'custom-video-model',
      fps: 0.75,
    })

    process.env.ARK_VIDEO_UNDERSTANDING_FPS = '0'
    expect(getArkVideoUnderstandingConfig().fps).toBe(0.5)
  })

  it('uploads, waits for processing, then sends the File ID to Responses API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'file-test', status: 'processing' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-test', status: 'processed' }))
      .mockResolvedValueOnce(jsonResponse({
        output_text: JSON.stringify(validAnalysis('board')),
        usage: { input_tokens: 120, output_tokens: 30 },
      }))

    const file = new File([new Uint8Array([0, 1, 2])], 'demo.mp4', { type: 'video/mp4' })
    const result = await understandVideoWithArk({
      apiKey: 'server-only-key',
      file,
      mode: 'board',
      model: 'video-understanding-model',
      fps: 0.5,
      fetchImpl: fetchMock as unknown as typeof fetch,
      pollIntervalMs: 0,
      sleep: async () => undefined,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ark.cn-beijing.volces.com/api/v3/files')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://ark.cn-beijing.volces.com/api/v3/files/file-test')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')

    const uploadBody = fetchMock.mock.calls[0]?.[1]?.body
    expect(uploadBody).toBeInstanceOf(FormData)
    expect((uploadBody as FormData).get('purpose')).toBe('user_data')
    expect((uploadBody as FormData).get('preprocess_configs[video][fps]')).toBe('0.5')

    const responseBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))
    expect(responseBody.model).toBe('video-understanding-model')
    expect(responseBody.instructions).toContain(VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION)
    expect(responseBody.input[0].content[0]).toEqual({
      type: 'input_video',
      file_id: 'file-test',
    })
    expect(responseBody.input[0].content[1].text).toContain('任务集号：1')
    expect(result.analysis).toEqual(validAnalysis('board'))
    expect(result.episodeScript).toBe('第1集\n1-1\n场景：测试房间 - 夜 - 暗\n人物：测试人物\n△测试人物抬头。')
    expect(result.sourceStoryboard).toContain('第1集 · 源分镜')
    expect(result.sourceStoryboard).toContain('资产：@测试人物、@测试房间')
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
    expect(result.validation).toEqual({ valid: true, errors: [], warnings: [] })
  })

  it('reports broken Panel references instead of silently accepting them', () => {
    const analysis = validAnalysis('board')
    analysis.source_storyboard.shots[0].source_beat_ids = ['missing-beat']
    analysis.source_storyboard.shots[0].referenced_assets.characters = ['missing-character']

    const validation = validateVideoRepaintAnalysis(analysis)
    expect(validation.valid).toBe(true)
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('unknown beat_id missing-beat'),
      expect.stringContaining('unknown asset missing-character'),
    ]))
  })

  it('streams the dedicated source storyboard without re-uploading the video', async () => {
    const sourceAnalysis = validAnalysis('script')
    const sourceStoryboard = {
      schema_version: VIDEO_SOURCE_STORYBOARD_SCHEMA_VERSION,
      episode_number: 1,
      shots: [{
        panel_id: 'E01-P001',
        panel_number: 1,
        scene_id: 'E01-S01',
        source_beat_ids: ['E01-S01-B01'],
        source_anchor: { start_time: '00:00:00.000', end_time: '00:00:01.000' },
        duration_seconds: 1,
        shot_size: '近景',
        camera_angle: '平拍',
        camera_movement: '固定',
        description: '测试人物抬头',
        action: '测试人物抬头',
        dialogue: [{ speaker_ref: 'character_1', text: '测试' }],
        referenced_assets: { characters: ['character_1'], location: 'location_1', props: [] },
      }],
      excluded_ranges: [],
      quality_report: {},
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse(JSON.stringify(sourceStoryboard)))
    const result = await understandSourceStoryboardWithArk({
      apiKey: 'server-only-key',
      fileId: 'file-test',
      sourceAnalysis,
      durationSeconds: 1,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(requestBody.stream).toBe(true)
    expect(requestBody.thinking).toEqual({ type: 'disabled' })
    expect(requestBody.input[0].content[0]).toEqual({ type: 'input_video', file_id: 'file-test' })
    expect(result.validation).toEqual({ valid: true, errors: [], warnings: [] })
    expect(result.formattedStoryboard).toContain('对白：@测试人物：测试')
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
  })

  it('extracts only the formatted single-episode screenplay for delivery', () => {
    expect(extractFormattedEpisodeScript(validAnalysis('script'))).toBe(
      '第1集\n1-1\n场景：测试房间 - 夜 - 暗\n人物：测试人物\n△测试人物抬头。',
    )
    expect(extractFormattedEpisodeScript({ source_episode: {} })).toBe('')
  })

  it('formats the source storyboard with readable @asset mentions', () => {
    const storyboard = formatSourceStoryboard(validAnalysis('board'))
    expect(storyboard).toContain('Shot 1 · E01-P001')
    expect(storyboard).toContain('时间码：00:00:00.000 → 00:00:01.000')
    expect(storyboard).toContain('资产：@测试人物、@测试房间')
    expect(storyboard).not.toContain('"source_storyboard"')
  })

  it('reports uncovered source timeline gaps between Panels', () => {
    const analysis = validAnalysis('board')
    analysis.source_storyboard.shots.push({
      ...analysis.source_storyboard.shots[0],
      panel_id: 'E01-P002',
      source_anchor: {
        start_time: '00:00:01.500',
        end_time: '00:00:02.000',
      },
    })

    const validation = validateVideoRepaintAnalysis(analysis)
    expect(validation.valid).toBe(true)
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('uncovered gap 00:00:01.000-00:00:01.500 (0.500s)'),
    ]))
  })

  it('rejects unsupported files before contacting Ark', async () => {
    const fetchMock = vi.fn()
    const file = new File([new Uint8Array([0])], 'demo.webm', { type: 'video/webm' })

    await expect(understandVideoWithArk({
      apiKey: 'server-only-key',
      file,
      mode: 'script',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('only mp4, avi and mov are supported')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces provider authentication errors without exposing the key', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      error: { message: 'invalid API key' },
    }, 401))
    const file = new File([new Uint8Array([0])], 'demo.mp4', { type: 'video/mp4' })

    await expect(understandVideoWithArk({
      apiKey: 'server-only-key',
      file,
      mode: 'script',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('invalid API key')
  })
})
