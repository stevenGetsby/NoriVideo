import { describe, expect, it } from 'vitest'

import { getTestModeModelKeys } from '@/lib/test-mode'
import { findNoriBusinessModel, NORI_DEFAULT_MODEL_KEYS } from '@/lib/nori-model-catalog'

describe('test-mode model defaults', () => {
  it('uses registered business keys resolved through administrator model routes', () => {
    const models = getTestModeModelKeys()
    expect(models).toEqual({
      analysisModel: NORI_DEFAULT_MODEL_KEYS.llm,
      imageModel: NORI_DEFAULT_MODEL_KEYS.image,
      videoModel: NORI_DEFAULT_MODEL_KEYS.video,
      audioModel: NORI_DEFAULT_MODEL_KEYS.audio,
    })
    for (const [type, key] of [['llm', models.analysisModel], ['image', models.imageModel], ['video', models.videoModel], ['audio', models.audioModel]] as const) {
      expect(findNoriBusinessModel(key)?.type).toBe(type)
    }
    expect(Object.values(models)).not.toContain('hfsy::gpt-5.5')
  })
})
