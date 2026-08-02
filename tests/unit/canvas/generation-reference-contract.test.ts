import { describe, expect, it } from 'vitest'
import {
  buildCanvasGenerationMaterialReferences,
  normalizeCanvasGenerationMaterialReferences,
} from '@/lib/canvas/generation-reference-contract'

describe('canvas generation reference roles', () => {
  it('builds explicit first and last frame roles in selected order', () => {
    expect(buildCanvasGenerationMaterialReferences(['start', 'end'], 'firstlastframe')).toEqual([
      { materialId: 'start', role: 'FIRST_FRAME' },
      { materialId: 'end', role: 'LAST_FRAME' },
    ])
  })

  it('requires and preserves the explicit first/last-frame role contract', () => {
    const result = normalizeCanvasGenerationMaterialReferences({
      value: [
        { materialId: 'start', role: 'FIRST_FRAME' },
        { materialId: 'end', role: 'LAST_FRAME' },
      ],
      legacyMaterialIds: ['start', 'end'],
      inputMode: 'firstlastframe',
      limit: 15,
    })

    expect(result).toEqual({
      success: true,
      references: [
        { materialId: 'start', role: 'FIRST_FRAME' },
        { materialId: 'end', role: 'LAST_FRAME' },
      ],
    })
  })

  it.each([
    { label: 'positional-only legacy input', value: undefined, legacyMaterialIds: ['start', 'end'] },
    { label: 'reversed roles', value: [{ materialId: 'start', role: 'LAST_FRAME' }, { materialId: 'end', role: 'FIRST_FRAME' }], legacyMaterialIds: ['start', 'end'] },
    { label: 'duplicate material', value: [{ materialId: 'same', role: 'FIRST_FRAME' }, { materialId: 'same', role: 'LAST_FRAME' }], legacyMaterialIds: ['same'] },
  ])('rejects $label for first/last-frame generation', ({ value, legacyMaterialIds }) => {
    expect(normalizeCanvasGenerationMaterialReferences({
      value,
      legacyMaterialIds,
      inputMode: 'firstlastframe',
      limit: 15,
    }).success).toBe(false)
  })

  it('keeps ordinary positional references backwards compatible as REF', () => {
    expect(normalizeCanvasGenerationMaterialReferences({
      value: undefined,
      legacyMaterialIds: ['image-1'],
      inputMode: 'text',
      limit: 9,
    })).toEqual({
      success: true,
      references: [{ materialId: 'image-1', role: 'REF' }],
    })
  })
})
