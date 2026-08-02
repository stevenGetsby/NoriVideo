import { describe, expect, it } from 'vitest'
import {
  assertCanvasImageInpaintSupported,
  parseCanvasImageEditTaskContract,
  supportsCanvasImageInpaint,
} from '@/lib/canvas/image-edit-contract'

describe('canvas image-edit contract', () => {
  it('allows only catalog models that explicitly declare supportsInpaint', () => {
    expect(supportsCanvasImageInpaint('openai-compatible:oa-1::gpt-image-1')).toBe(true)
    expect(supportsCanvasImageInpaint('fal::banana-2')).toBe(false)
    expect(supportsCanvasImageInpaint('unknown::image-model')).toBe(false)
    expect(() => assertCanvasImageInpaintSupported('fal::banana-2')).toThrow(/unsupported|does not support/i)
  })

  it('parses mask data only as an explicit image_edit/inpaint contract', () => {
    expect(parseCanvasImageEditTaskContract({
      processType: 'image_edit',
      editMode: 'inpaint',
      maskImage: 'images/source-mask.png',
      maskMaterialId: 'material-mask-1',
    })).toEqual({
      processType: 'image_edit',
      editMode: 'inpaint',
      maskImage: 'images/source-mask.png',
      maskMaterialId: 'material-mask-1',
    })
  })

  it('rejects mask fields on a normal image task instead of treating them as references', () => {
    expect(() => parseCanvasImageEditTaskContract({
      processType: 'image_generate',
      maskImage: 'images/source-mask.png',
      maskMaterialId: 'material-mask-1',
    })).toThrow(/mask fields require processType=image_edit/i)
  })

  it.each([
    { label: 'edit mode', payload: { maskImage: 'mask.png', maskMaterialId: 'mask-1' } },
    { label: 'mask image', payload: { editMode: 'inpaint', maskMaterialId: 'mask-1' } },
    { label: 'mask material id', payload: { editMode: 'inpaint', maskImage: 'mask.png' } },
  ])('rejects image_edit without its required $label', ({ payload }) => {
    expect(() => parseCanvasImageEditTaskContract({
      processType: 'image_edit',
      ...payload,
    })).toThrow(/image_edit requires/i)
  })
})
