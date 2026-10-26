import { describe, expect, it } from 'vitest'
import {
  buildToolboxWorkTrace,
  formatToolboxWorkTrace,
  toolboxModelLabel,
} from '@/components/frameos/views/toolbox-work-trace'

const baseSource = {
  type: 'video',
  status: 'completed',
  modelId: 'nori::seedance2.0',
  createdAt: '2026-10-25T09:30:00.000Z',
  params: {
    title: '雨夜奔逃',
    prompt: '@苏晚卿 在雨夜向前奔跑，镜头跟拍。\n雨声渐强。',
    inputMode: 'text',
    assetCategory: 'shot',
    aspectRatio: '9:16',
    resolution: '1080p',
    duration: 8,
    fps: 24,
    generateAudio: true,
    referenceSummary: [
      { id: 'image-1', title: '苏晚卿', type: 'image', role: 'REF' },
      { id: 'audio-1', title: '苏晚卿音色', type: 'audio', role: 'REF', durationSeconds: 4.25 },
      { id: 'video-1', title: '奔跑运镜', type: 'video', role: 'REF', durationSeconds: 6 },
    ],
  },
  task: {
    id: 'task-123',
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    costPoints: 12.5,
  },
}

describe('toolbox work trace', () => {
  it('records prompt, model, mode, parameters, references, cost, and task identity', () => {
    const trace = buildToolboxWorkTrace(baseSource, { modelName: 'Seedance 2.0' })

    expect(trace).toMatchObject({
      title: '雨夜奔逃',
      prompt: '@苏晚卿 在雨夜向前奔跑，镜头跟拍。\n雨声渐强。',
      status: 'completed',
      statusLabel: '已完成',
      statusTone: 'success',
      model: 'Seedance 2.0',
      mode: '全能参考（图片 / 视频 / 音色）',
      costPoints: 12.5,
      costLabel: '12.5 积分',
      assetCategoryLabel: '镜头素材',
      taskId: 'task-123',
      errorCode: null,
      errorMessage: null,
    })
    expect(trace.options).toEqual([
      { label: '画面比例', value: '9:16' },
      { label: '分辨率', value: '1080p' },
      { label: '视频时长', value: '8 秒' },
      { label: '帧率', value: '24 FPS' },
      { label: '同步生成声音', value: '开启' },
    ])
    expect(trace.references.map((item) => [item.title, item.typeLabel, item.roleLabel, item.durationLabel])).toEqual([
      ['苏晚卿', '图片', '参考', null],
      ['苏晚卿音色', '音频', '参考', '4.3 秒'],
      ['奔跑运镜', '视频', '参考', '6 秒'],
    ])
    expect(trace.createdAtLabel).not.toBe('—')
  })

  it('produces a copyable trace that includes the prompt, references, and billing record', () => {
    const text = formatToolboxWorkTrace(buildToolboxWorkTrace(baseSource, { modelName: 'Seedance 2.0' }))

    expect(text).toContain('【工作留痕】雨夜奔逃')
    expect(text).toContain('模型：Seedance 2.0')
    expect(text).toContain('模式：全能参考（图片 / 视频 / 音色）')
    expect(text).toContain('参考素材：3 个')
    expect(text).toContain('2. 苏晚卿音色（音频 · 参考 · 4.3 秒）')
    expect(text).toContain('雨声渐强。')
    expect(text).toContain('任务 ID：task-123')
    expect(text).toContain('消耗积分：12.5 积分')
    expect(text).not.toContain('requestHash')
    expect(text).not.toContain('idempotencyKey')
  })

  it('labels pure text, image-to-video, first/last frame, and legacy reference inputs correctly', () => {
    const textTrace = buildToolboxWorkTrace({ type: 'video', status: 'completed', params: { inputMode: 'text', prompt: '无参考' } })
    expect(textTrace.mode).toBe('文生视频（仅提示词）')
    expect(textTrace.costLabel).toBe('未计费')

    const imageTrace = buildToolboxWorkTrace({
      type: 'video',
      status: 'processing',
      params: { inputMode: 'image', referenceSummary: [{ title: '首图', type: 'image', role: 'REF' }] },
    })
    expect(imageTrace.mode).toBe('图生视频')
    expect(imageTrace.statusLabel).toBe('生成中')
    expect(imageTrace.costLabel).toBe('结算中')

    const frameTrace = buildToolboxWorkTrace({
      type: 'video',
      status: 'queued',
      params: { inputMode: 'firstlastframe', referenceSummary: [{ title: '首', type: 'image', role: 'FIRST_FRAME' }] },
    })
    expect(frameTrace.mode).toBe('首尾帧')
    expect(frameTrace.references[0]).toMatchObject({ typeLabel: '图片', roleLabel: '首帧' })

    const legacyTrace = buildToolboxWorkTrace({
      type: 'video',
      status: 'completed',
      params: { inputMode: 'text', referenceMaterials: [{ materialId: 'm-1', role: 'REF' }] },
    })
    expect(legacyTrace.mode).toBe('全能参考（图片 / 视频 / 音色）')
    expect(legacyTrace.references[0]).toMatchObject({ title: '参考素材 1', typeLabel: '素材' })
  })

  it('keeps failed tasks readable and does not invent billing or task data', () => {
    const trace = buildToolboxWorkTrace({
      type: 'video',
      status: 'failed',
      errorMessage: 'provider timeout',
      params: { title: '失败镜头', prompt: '镜头', inputMode: 'text' },
      task: { id: 'task-failed', status: 'failed', errorCode: 'PROVIDER_TIMEOUT', errorMessage: '生成超时', costPoints: null },
    })

    expect(trace).toMatchObject({
      statusLabel: '失败',
      statusTone: 'failure',
      costPoints: null,
      costLabel: '无扣费记录',
      errorCode: 'PROVIDER_TIMEOUT',
      errorMessage: '生成超时',
      taskId: 'task-failed',
    })
    const text = formatToolboxWorkTrace(trace)
    expect(text).toContain('失败原因：[PROVIDER_TIMEOUT] 生成超时')
    expect(text).toContain('参考素材：无')
  })

  it('survives malformed params and falls back to a readable model label', () => {
    const trace = buildToolboxWorkTrace({
      type: 'image',
      status: 'completed',
      modelId: 'nori::seedance2.0-fast',
      params: {
        title: '   ',
        prompt: '   ',
        aspectRatio: 16 / 9,
        quality: 'unknown-quality',
        referenceSummary: 'not-an-array',
      },
      createdAt: 'not-a-date',
    })

    expect(trace.title).toBe('未命名生成')
    expect(trace.prompt).toBe('')
    expect(trace.model).toBe('Seedance 2.0 Fast')
    expect(trace.mode).toBe('图片生成')
    expect(trace.options).toEqual([
      { label: '画面比例', value: String(16 / 9) },
      { label: '画质', value: 'unknown-quality' },
    ])
    expect(trace.references).toEqual([])
    expect(trace.createdAtLabel).toBe('not-a-date')
    expect(toolboxModelLabel(null)).toBe('')
    expect(toolboxModelLabel('nori::seedance2.0')).toBe('Seedance 2.0')
  })
})
