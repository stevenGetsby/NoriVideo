import { describe, expect, it } from 'vitest'
import {
  calcImage,
  calcText,
  calcVideo,
  calcVideoByTokens,
  calcVideoByDuration,
  calcVoice,
} from '@/lib/billing/cost'
import { NORI_BUSINESS_MODELS } from '@/lib/nori-model-catalog'
import { listKuaiziCatalogModels } from '@/lib/providers/kuaizi/catalog'
import { calculateUsageCost } from '@/lib/platform-services/usage-cost'

function usageRow(overrides: Partial<{
  provider: string
  modelKey: string | null
  serviceType: string
  operation: string
  status: string
  inputTokens: number
  outputTokens: number
  units: number
  metadata: Record<string, unknown>
}> = {}) {
  return {
    provider: 'kuaizi',
    modelKey: 'kuaizi::deepseek-v4-pro',
    serviceType: 'llm',
    operation: 'chat-completion',
    status: 'success',
    inputTokens: 0,
    outputTokens: 0,
    units: 1,
    latencyMs: 10,
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    ...overrides,
  }
}

describe('nori and kuaizi price mapping', () => {
  it('settles seedance 2.0 mini by measured duration even when tokens are reported', () => {
    for (const modelKey of ['nori::seedance2.0-mini', 'kuaizi::doubao-seedance-2-0-mini-260615']) {
      expect(calcVideoByDuration(modelKey, 6.25, '480p')).toBeCloseTo(0.49 * 1.25, 8)
      expect(calculateUsageCost(usageRow({
        modelKey, serviceType: 'video', units: 6.25, outputTokens: 120000, metadata: { resolution: '480p' },
      }))).toBeCloseTo(0.49 * 1.25, 8)
    }
  })

  it('settles seedance 2.5 by tokens even when measured duration is reported', () => {
    // 6.25s 实测时长按 6s 档计：token 公式 ceil(6 × 864 × 496 × 24 / 1024) × 70 元/百万
    const expected = Math.ceil(6 * 864 * 496 * 24 / 1024) / 1_000_000 * 70
    for (const modelKey of ['nori::norivideo2.5', 'kuaizi::doubao-seedance-2-5-260628']) {
      expect(calcVideoByDuration(modelKey, 6.25, '480p')).toBeCloseTo(expected, 8)
      // 有实际 token 上报时按 token 精确结算：120000 × 70 元/百万
      expect(calculateUsageCost(usageRow({
        modelKey, serviceType: 'video', units: 6.25, outputTokens: 120000, metadata: { resolution: '480p' },
      }))).toBeCloseTo(8.4, 8)
    }
  })

  it('snaps non-integer durations to supported options and supports official 2.5 1080p', () => {
    // 6.25s 会取整到 6s 档，不再抛错
    expect(calcVideo('nori::norivideo2.5', '480p', 1, { duration: 6.25, resolution: '480p' }))
      .toBeCloseTo(Math.ceil(6 * 864 * 496 * 24 / 1024) / 1_000_000 * 70, 8)
    // 1080p 是官方支持的档位（v1.2），按 77 元/百万 token 计价
    expect(calcVideoByDuration('nori::norivideo2.5', 6.25, '1080p')).toBeCloseTo(
      Math.ceil(6 * 1920 * 1088 * 24 / 1024) / 1_000_000 * 77, 8)
  })

  it('prices every Nori business model so user tasks can freeze points', () => {
    for (const model of NORI_BUSINESS_MODELS) {
      if (model.type === 'llm') {
        expect(calcText(model.key, 1_000_000, 1_000_000)).toBeGreaterThan(0)
        continue
      }
      if (model.type === 'image') {
        expect(calcImage(model.key, 1)).toBeGreaterThan(0)
        continue
      }
      if (model.type === 'video') {
        expect(calcVideo(model.key, '720p', 1, {
          resolution: '720p',
          duration: 5,
          aspectRatio: '16:9',
        })).toBeGreaterThan(0)
        continue
      }
      expect(calcVoice(5, model.key)).toBeGreaterThan(0)
    }
  })

  it('prices every Kuaizi catalog model used as a routed upstream key', () => {
    for (const model of listKuaiziCatalogModels()) {
      const key = `kuaizi::${model.modelId}`
      if (model.modality === 'llm') {
        expect(calcText(key, 1_000_000, 1_000_000)).toBeGreaterThan(0)
        continue
      }
      if (model.modality === 'image') {
        expect(calcImage(key, 1)).toBeGreaterThan(0)
        continue
      }
      if (model.modality === 'video') {
        expect(calcVideo(key, '720p', 1, {
          resolution: '720p',
          duration: 5,
          aspectRatio: '16:9',
        })).toBeGreaterThan(0)
        continue
      }
      expect(calcVoice(5, key)).toBeGreaterThan(0)
    }
  })

  it('keeps Seedance 2.0 token rates when the same modelId is served by Kuaizi', () => {
    const ark = calcVideo('ark::doubao-seedance-2-0-260128', '720p', 1, {
      resolution: '720p',
      duration: 5,
      aspectRatio: '16:9',
      containsVideoInput: false,
    })
    const kuaizi = calcVideo('kuaizi::doubao-seedance-2-0-260128', '720p', 1, {
      resolution: '720p',
      duration: 5,
      aspectRatio: '16:9',
      containsVideoInput: false,
    })
    expect(kuaizi).toBeCloseTo(ark, 8)
    expect(calcVideoByTokens('kuaizi::doubao-seedance-2-0-260128', 120_000, {
      containsVideoInput: false,
    })).toBeCloseTo(7.452, 8)
  })

  it('charges Kuaizi Kling by duration instead of skipping as unknown', () => {
    expect(calcVideo('kuaizi::kling-v3-omni', '720p', 1, { duration: 5 })).toBeCloseTo(0.84, 8)
    expect(calcVideo('kuaizi::kling-v3-omni', '720p', 1, { duration: 10 })).toBeCloseTo(1.68, 8)
  })

  it('records API usage amounts from the same catalog as point billing', () => {
    expect(calculateUsageCost(usageRow({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }))).toBeCloseTo(48.6, 8)

    expect(calculateUsageCost(usageRow({
      serviceType: 'image',
      modelKey: 'nori::nori-image',
      units: 2,
    }))).toBeCloseTo(0.1, 8)

    expect(calculateUsageCost(usageRow({
      serviceType: 'video',
      modelKey: 'kuaizi::kling-v3-omni',
      operation: 'toolbox_video:no-video-input',
      units: 5,
    }))).toBeCloseTo(0.84, 8)

    expect(calculateUsageCost(usageRow({
      serviceType: 'audio',
      modelKey: 'kuaizi::speech-2.8-hd',
      units: 10,
    }))).toBeCloseTo(0.2, 8)

    // Seedance 2.5：5s 720p 16:9 按官方 token 价 70 元/百万
    expect(calcVideo('kuaizi::doubao-seedance-2-5-260628', '720p', 1, {
      resolution: '720p',
      duration: 5,
      generateAudio: false,
    })).toBeCloseTo(7.56, 8)

    expect(calculateUsageCost(usageRow({
      provider: 'ark',
      modelKey: 'ark::doubao-seed-2-1-pro-260628',
      serviceType: 'video-repaint',
      operation: 'video-understanding-script',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }))).toBeCloseTo(48.6, 8)
  })
})
