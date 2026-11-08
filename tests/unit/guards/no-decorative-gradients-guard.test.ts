import { describe, expect, it } from 'vitest'
import { inspectDecorativeGradients } from '../../../scripts/guards/no-decorative-gradients-guard.mjs'

describe('decorative gradient guard', () => {
  it('keeps owned UI source free of CSS, SVG and Tailwind gradient decoration', () => {
    const { violations } = inspectDecorativeGradients()
    expect(violations).toEqual([])
  })
})
