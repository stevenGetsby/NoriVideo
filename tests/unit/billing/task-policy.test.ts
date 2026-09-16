import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo, isBillableTaskType, requiresTaskBilling } from '@/lib/billing/task-policy'
import type { TaskBillingInfo } from '@/lib/task/types'

function expectBillableInfo(info: TaskBillingInfo | null): Extract<TaskBillingInfo, { billable: true }> {
  expect(info).toBeTruthy()
  expect(info?.billable).toBe(true)
  if (!info || !info.billable) {
    throw new Error('Expected billable task billing info')
  }
  return info
}

describe('billing/task-policy', () => {
  const billingPayload = {
    analysisModel: 'anthropic/claude-sonnet-4',
    imageModel: 'seedream',
    videoModel: 'doubao-seedance-1-5-pro-251215',
  } as const

  it('builds TaskBillingInfo for every billable task type', () => {
    for (const taskType of Object.values(TASK_TYPE)) {
      if (!isBillableTaskType(taskType)) continue
      const info = expectBillableInfo(buildDefaultTaskBillingInfo(taskType, billingPayload))
      expect(info.taskType).toBe(taskType)
      expect(info.maxFrozenCost).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns null for a non-billable task type', () => {
    const fake = 'not_billable' as unknown as (typeof TASK_TYPE)[keyof typeof TASK_TYPE]
    expect(isBillableTaskType(fake)).toBe(false)
    expect(buildDefaultTaskBillingInfo(fake, {})).toBeNull()
  })

  it('requires a price adapter before external 3D generation can run', () => {
    expect(isBillableTaskType(TASK_TYPE.TOOLBOX_MODEL_3D)).toBe(false)
    expect(requiresTaskBilling(TASK_TYPE.TOOLBOX_MODEL_3D, {
      model3dModel: 'frameos3d::frameos-3d-v1',
    })).toBe(true)
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.TOOLBOX_MODEL_3D, {
      model3dModel: 'frameos3d::frameos-3d-v1',
    })).toBeNull()
  })

  it('builds text billing info from explicit model payload', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.ANALYZE_NOVEL, {
      analysisModel: 'anthropic/claude-sonnet-4',
    }))
    expect(info.apiType).toBe('text')
    expect(info.model).toBe('anthropic/claude-sonnet-4')
    expect(info.quantity).toBe(4200)
  })

  it('returns null for missing required models in text/image/video tasks', () => {
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.ANALYZE_NOVEL, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, {})).toBeNull()
  })

  it('honors candidateCount/count for image tasks', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, {
      candidateCount: 4,
      imageModel: 'seedream4',
    }))
    expect(info.apiType).toBe('image')
    expect(info.quantity).toBe(4)
    expect(info.model).toBe('seedream4')
  })

  it('builds video billing info from firstLastFrame.flModel', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, {
      firstLastFrame: {
        flModel: 'doubao-seedance-1-0-pro-250528',
      },
      duration: 8,
    }))
    expect(info.apiType).toBe('video')
    expect(info.model).toBe('doubao-seedance-1-0-pro-250528')
    expect(info.quantity).toBe(1)
  })

  it('marks reference-video tasks with their input duration for Seedance pricing', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.TOOLBOX_VIDEO, {
      videoModel: 'nori::seedance2.0',
      referenceVideos: ['video/run.mp4'],
      inputVideoSeconds: 6.5,
      generationOptions: {
        resolution: '720p',
        duration: 5,
        aspectRatio: '16:9',
      },
    }))
    expect(info.metadata).toMatchObject({
      containsVideoInput: true,
      inputVideoSeconds: 6.5,
    })
  })

  it('quotes voice tasks against the selected audio model', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, {
      audioModel: 'nori::nori-audio',
      maxSeconds: 8,
    }))
    expect(info.apiType).toBe('voice')
    expect(info.model).toBe('nori::nori-audio')
    expect(info.quantity).toBe(8)
    expect(info.maxFrozenCost).toBeGreaterThan(0)
  })

  it('uses explicit lip sync model from payload', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.LIP_SYNC, {
      lipSyncModel: 'vidu::vidu-lipsync',
    }))
    expect(info.apiType).toBe('lip-sync')
    expect(info.model).toBe('vidu::vidu-lipsync')
    expect(info.quantity).toBe(1)
  })

  it('quotes toolbox audio against duration and the selected model', () => {
    expect(isBillableTaskType(TASK_TYPE.TOOLBOX_AUDIO)).toBe(true)
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.TOOLBOX_AUDIO, {
      audioModel: 'kuaizi::speech-2.8-hd',
      duration: 12,
    }))
    expect(info.apiType).toBe('voice')
    expect(info.model).toBe('kuaizi::speech-2.8-hd')
    expect(info.quantity).toBe(12)
    expect(info.maxFrozenCost).toBeCloseTo(0.24, 8)
  })

  it('quotes paid canvas video_edit and leaves local processing unbilled', () => {
    expect(requiresTaskBilling(TASK_TYPE.CANVAS_VIDEO_OPERATION, {
      operation: 'video_edit',
      engineKey: 'kuaizi-seedance25',
      modelKey: 'doubao-seedance-2-5-260628',
    })).toBe(true)
    expect(requiresTaskBilling(TASK_TYPE.CANVAS_VIDEO_OPERATION, {
      operation: 'subtitle_erase',
      engineKey: 'local-ffmpeg',
      modelKey: 'local-ffmpeg',
    })).toBe(false)

    const billed = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.CANVAS_VIDEO_OPERATION, {
      operation: 'video_edit',
      engineKey: 'kuaizi-seedance25',
      modelKey: 'doubao-seedance-2-5-260628',
      parameters: {
        startMs: 1_000,
        endMs: 6_000,
        generateAudio: false,
      },
    }))
    expect(billed.apiType).toBe('video')
    expect(billed.model).toBe('kuaizi::doubao-seedance-2-5-260628')
    expect(billed.metadata).toMatchObject({
      resolution: '720p',
      duration: 5,
      containsVideoInput: true,
      generateAudio: false,
    })
    expect(billed.maxFrozenCost).toBeGreaterThan(0)

    expect(buildDefaultTaskBillingInfo(TASK_TYPE.CANVAS_VIDEO_OPERATION, {
      operation: 'video_superresolve',
      engineKey: 'local-ffmpeg',
      modelKey: 'local-ffmpeg',
    })).toBeNull()
  })
})
