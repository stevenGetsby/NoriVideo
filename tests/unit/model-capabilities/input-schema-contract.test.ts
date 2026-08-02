import { describe, expect, it } from 'vitest'
import { validateModelCapabilities } from '@/lib/model-config-contract'

describe('model capability input schema contract', () => {
  it('accepts reference counts, audio duration and required fields', () => {
    expect(validateModelCapabilities('video', {
      video: {
        inputSchema: {
          image: { min: 0, max: 9 },
          video: { min: 0, max: 3 },
          audio: { min: 0, max: 3, maxTotalDurationSeconds: 15 },
          requiredFields: ['prompt'],
        },
      },
    })).toEqual([])
  })

  it('rejects inverted limits and unknown param-schema fields', () => {
    const issues = validateModelCapabilities('video', {
      video: {
        inputSchema: {
          image: { min: 3, max: 2, unknown: true },
        },
      },
    })
    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining([
      'capabilities.video.inputSchema.image.unknown',
      'capabilities.video.inputSchema.image',
    ]))
  })
})
