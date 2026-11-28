import { describe, expect, it } from 'vitest'
import { resolveVideoCapabilities as extractVideoCapabilities } from '@/components/batch-workflow/workflow-client-utils'

describe('workflow video capability defaults', () => {
  it('disables first/last frame for an unknown model', () => {
    expect(extractVideoCapabilities('missing', []).supportsFirstLastFrame).toBe(false)
  })

  it('keeps explicit known capabilities unchanged', () => {
    expect(extractVideoCapabilities('known', [{
      modelKey: 'known', firstLastFrame: true,
      options: { generationModeOptions: ['firstlastframe'], durationOptions: [4, 10] },
    }])).toEqual({ supportsFirstLastFrame: true, minDurationSec: 4, maxDurationSec: 10 })
    expect(extractVideoCapabilities('known', [{
      modelKey: 'known', firstLastFrame: true,
      options: { generationModeOptions: ['text'] },
    }]).supportsFirstLastFrame).toBe(false)
  })
})
