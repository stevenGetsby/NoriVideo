import { describe, expect, it } from 'vitest'
import {
  buildToolboxGenerationRequestBody,
  buildToolboxRegenerationDraft,
  isToolboxGenerationSubmitDisabled,
  resolveToolboxRegenerationModelKey,
  type ToolboxGenerationRequestInput,
} from '@/components/frameos/views/toolbox-regeneration'

const videoSource = {
  type: 'video',
  modelId: 'doubao-seedance-2-5-260628',
  params: {
    title: '雨夜奔逃',
    prompt: '@苏晚卿 在雨夜向前奔跑，镜头跟拍。',
    modelKey: 'kuaizi::doubao-seedance-2-5-260628',
    inputMode: 'reference',
    assetCategory: 'shot',
    aspectRatio: '9:16',
    resolution: '1080p',
    duration: 8,
    fps: 24,
    generateAudio: false,
    referenceSummary: [
      { id: 'image-1', title: '苏晚卿', type: 'image', role: 'REF' },
      { id: 'video-1', title: '奔跑运镜', type: 'video', role: 'REF', durationSeconds: 6.5 },
      { id: 'audio-1', title: '雨声', type: 'audio', role: 'REF', durationSeconds: 4.25 },
    ],
    idempotencyKey: 'source-idempotency-key',
    requestHash: 'source-request-hash',
    canvasId: 'canvas-source',
    nodeId: 'node-source',
  },
}

function submitState(overrides: Partial<Parameters<typeof isToolboxGenerationSubmitDisabled>[0]> = {}) {
  return {
    submitting: false,
    generationAllowed: true,
    projectsLoading: false,
    projectsError: null,
    workId: 'work-1',
    projectId: 'project-1',
    modelKey: 'kuaizi::doubao-seedance-2-5-260628',
    configLoading: false,
    modelAvailable: true,
    ...overrides,
  }
}

function requestInput(overrides: Partial<ToolboxGenerationRequestInput> = {}): ToolboxGenerationRequestInput {
  return {
    workId: 'work-1',
    projectId: 'project-1',
    type: 'video',
    title: '  雨夜奔逃（再生成）  ',
    prompt: '  苏晚卿在雨夜转身。  ',
    modelKey: 'kuaizi::doubao-seedance-2-5-260628',
    assetCategory: 'shot',
    referenceMaterialIds: ['image-1'],
    referenceMaterials: [{ materialId: 'image-1', role: 'REF' }],
    inputMode: 'reference',
    textOnly: false,
    options: { aspectRatio: '9:16', duration: 8 },
    ...overrides,
  }
}

describe('toolbox regeneration draft', () => {
  it('loads the source prompt, title, parameters, and ordered references into an editable draft', () => {
    const draft = buildToolboxRegenerationDraft(videoSource, 'video')

    expect(draft).toEqual({
      title: '雨夜奔逃',
      prompt: '@苏晚卿 在雨夜向前奔跑，镜头跟拍。',
      modelKey: 'kuaizi::doubao-seedance-2-5-260628',
      ratio: '9:16',
      resolution: '1080p',
      quality: 'high',
      inputMode: 'reference',
      duration: 8,
      fps: 24,
      generateAudio: false,
      assetCategory: 'shot',
      references: [
        expect.objectContaining({ id: 'image-1', title: '苏晚卿', type: 'image' }),
        expect.objectContaining({ id: 'video-1', title: '奔跑运镜', type: 'video', metadata: { durationSeconds: 6.5 } }),
        expect.objectContaining({ id: 'audio-1', title: '雨声', type: 'audio', metadata: { durationSeconds: 4.25 } }),
      ],
    })
  })

  it('keeps the draft detached from the source asset so edits cannot rewrite history', () => {
    const source = structuredClone(videoSource)
    const draft = buildToolboxRegenerationDraft(source, 'video')!

    draft.title = '换一个标题'
    draft.prompt = '换一段提示词'
    draft.references[0]!.title = '换一个角色名'
    draft.references.push({ ...draft.references[0]!, id: 'extra' })

    expect(source.params.title).toBe('雨夜奔逃')
    expect(source.params.prompt).toBe('@苏晚卿 在雨夜向前奔跑，镜头跟拍。')
    expect(source.params.referenceSummary[0].title).toBe('苏晚卿')
    expect(source.params.referenceSummary).toHaveLength(3)
  })

  it('never restores the source idempotency key, request hash, or canvas binding', () => {
    const draft = buildToolboxRegenerationDraft(videoSource, 'video')!
    const serialized = JSON.stringify(draft)

    expect(serialized).not.toContain('source-idempotency-key')
    expect(serialized).not.toContain('source-request-hash')
    expect(serialized).not.toContain('canvas-source')
    expect(serialized).not.toContain('node-source')
    expect(draft).not.toHaveProperty('idempotencyKey')
    expect(draft).not.toHaveProperty('requestHash')
  })

  it('ignores a mismatched generation type and unsupported reference rows', () => {
    expect(buildToolboxRegenerationDraft(videoSource, 'image')).toBeNull()

    const draft = buildToolboxRegenerationDraft({
      type: 'video',
      params: {
        referenceSummary: [
          { id: 'image-1', type: 'image', title: '有效图片' },
          { id: '', type: 'image', title: '缺少 ID' },
          { id: 'unknown-1', type: 'document', title: '无效类型' },
        ],
      },
    }, 'video')

    expect(draft?.references).toEqual([expect.objectContaining({ id: 'image-1', type: 'image' })])
  })

  it('uses the legacy image-only reference fallback but never guesses legacy video media', () => {
    const imageDraft = buildToolboxRegenerationDraft({
      type: 'image',
      params: { referenceMaterials: [{ materialId: 'image-1' }] },
    }, 'image')
    expect(imageDraft?.references).toEqual([
      expect.objectContaining({ id: 'image-1', type: 'image', title: '参考素材 1' }),
    ])

    const videoDraft = buildToolboxRegenerationDraft({
      type: 'video',
      params: { referenceMaterials: [{ materialId: 'material-1', role: 'REF' }] },
    }, 'video')
    expect(videoDraft?.references).toEqual([])
  })

  it.each([
    {
      label: 'image categories and input mode',
      type: 'image' as const,
      params: { assetCategory: 'shot', inputMode: 'firstlastframe', quality: 'ultra', duration: 99, fps: 999 },
      expected: { assetCategory: 'other', inputMode: 'text', quality: 'high', duration: 5, fps: null },
    },
    {
      label: 'video categories and input mode',
      type: 'video' as const,
      params: { assetCategory: 'character', inputMode: 'unsupported', duration: 3, fps: 0 },
      expected: { assetCategory: 'shot', inputMode: 'reference', duration: 5, fps: null },
    },
  ])('normalizes invalid $label instead of forwarding them to the paid task', ({ type, params, expected }) => {
    const draft = buildToolboxRegenerationDraft({ type, params }, type)
    expect(draft).toMatchObject(expected)
  })

  it('maps historical runtime and public model ids back to an available account model', () => {
    const available = ['nori::seedance2.0', 'kuaizi::doubao-seedance-2-5-260628']

    expect(resolveToolboxRegenerationModelKey({
      requestedModelKey: 'kuaizi::doubao-seedance-2-5-260628',
      modelId: 'doubao-seedance-2-5-260628',
      availableModelKeys: available,
    })).toBe('kuaizi::doubao-seedance-2-5-260628')

    expect(resolveToolboxRegenerationModelKey({
      requestedModelKey: 'legacy-provider::seedance2.0',
      modelId: 'seedance2.0',
      availableModelKeys: available,
    })).toBe('nori::seedance2.0')

    expect(resolveToolboxRegenerationModelKey({
      requestedModelKey: 'retired::model',
      modelId: 'retired-model',
      availableModelKeys: available,
    })).toBe('')
  })
})

describe('toolbox regeneration submission', () => {
  it('mints a new idempotency key per submission and keeps edited title and prompt', () => {
    const keys = ['key-1', 'key-2']
    const first = buildToolboxGenerationRequestBody(requestInput(), () => keys.shift()!)
    const second = buildToolboxGenerationRequestBody(requestInput(), () => keys.shift()!)

    expect(first.idempotencyKey).toBe('key-1')
    expect(second.idempotencyKey).toBe('key-2')
    expect(first).toMatchObject({
      title: '雨夜奔逃（再生成）',
      prompt: '苏晚卿在雨夜转身。',
      workId: 'work-1',
      projectId: 'project-1',
      type: 'video',
      modelKey: 'kuaizi::doubao-seedance-2-5-260628',
      inputMode: 'reference',
      textOnly: false,
    })
    expect(first.referenceMaterialIds).toEqual(['image-1'])
    expect(first.referenceMaterials).toEqual([{ materialId: 'image-1', role: 'REF' }])
  })

  it('whitelists only form fields so a selected source asset cannot be overwritten in place', () => {
    const input = {
      ...requestInput(),
      assetId: 'source-asset',
      sourceAssetId: 'source-asset',
      idempotencyKey: 'source-idempotency-key',
      requestHash: 'source-request-hash',
      canvasId: 'source-canvas',
      nodeId: 'source-node',
    } as ToolboxGenerationRequestInput

    const body = buildToolboxGenerationRequestBody(input, () => 'fresh-key')
    const serialized = JSON.stringify(body)

    expect(serialized).not.toContain('source-asset')
    expect(serialized).not.toContain('source-idempotency-key')
    expect(serialized).not.toContain('source-request-hash')
    expect(serialized).not.toContain('source-canvas')
    expect(serialized).not.toContain('source-node')
    expect(body.idempotencyKey).toBe('fresh-key')
  })

  it('copies mutable inputs so later form edits cannot mutate an in-flight request', () => {
    const input = requestInput()
    const body = buildToolboxGenerationRequestBody(input, () => 'key-1')

    ;(input.referenceMaterialIds as string[])[0] = 'mutated'
    input.referenceMaterials[0]!.role = 'LAST_FRAME'
    ;(input.options as Record<string, string | number | boolean>).duration = 99

    expect(body.referenceMaterialIds).toEqual(['image-1'])
    expect(body.referenceMaterials).toEqual([{ materialId: 'image-1', role: 'REF' }])
    expect(body.options.duration).toBe(8)
  })

  it('refuses to submit without a usable idempotency key', () => {
    expect(() => buildToolboxGenerationRequestBody(requestInput(), () => '   ')).toThrow(/幂等键/)
  })
})

describe('toolbox generate button guard', () => {
  it('blocks duplicate clicks while a submission is in flight', () => {
    expect(isToolboxGenerationSubmitDisabled(submitState())).toBe(false)
    expect(isToolboxGenerationSubmitDisabled(submitState({ submitting: true }))).toBe(true)
  })

  it.each([
    { label: 'account cannot generate', overrides: { generationAllowed: false } },
    { label: 'projects still loading', overrides: { projectsLoading: true } },
    { label: 'project load failed', overrides: { projectsError: '加载作品失败' } },
    { label: 'no work ownership', overrides: { workId: '' } },
    { label: 'no project ownership', overrides: { projectId: '' } },
    { label: 'no model', overrides: { modelKey: '' } },
    { label: 'model config loading', overrides: { configLoading: true } },
    { label: 'model unavailable', overrides: { modelAvailable: false } },
  ])('blocks unsafe submissions: $label', ({ overrides }) => {
    expect(isToolboxGenerationSubmitDisabled(submitState(overrides))).toBe(true)
  })
})
