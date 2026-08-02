import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'

export const CANVAS_IMAGE_EDIT_PROCESS_TYPE = 'image_edit' as const
export const CANVAS_IMAGE_EDIT_MODE = 'inpaint' as const

export type CanvasImageEditTaskContract = {
  processType: typeof CANVAS_IMAGE_EDIT_PROCESS_TYPE
  editMode: typeof CANVAS_IMAGE_EDIT_MODE
  maskImage: string
  maskMaterialId: string
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isCanvasImageEditProcessType(
  value: unknown,
): value is typeof CANVAS_IMAGE_EDIT_PROCESS_TYPE {
  return cleanString(value) === CANVAS_IMAGE_EDIT_PROCESS_TYPE
}

/**
 * Image inpainting is opt-in. Unknown/custom models must not silently receive a
 * mask as an ordinary reference image because that changes the requested edit
 * semantics and can incur a paid request that cannot honour the user's mask.
 */
export function supportsCanvasImageInpaint(modelKey: string): boolean {
  return resolveBuiltinCapabilitiesByModelKey('image', modelKey)?.image?.supportsInpaint === true
}

export function assertCanvasImageInpaintSupported(modelKey: string): void {
  if (!supportsCanvasImageInpaint(modelKey)) {
    throw new Error(`CANVAS_IMAGE_INPAINT_UNSUPPORTED: ${modelKey || 'unknown model'} does not support mask editing`)
  }
}

/** Strictly parses the task-only portion of an image-edit payload. */
export function parseCanvasImageEditTaskContract(payload: Record<string, unknown>): CanvasImageEditTaskContract | null {
  const processType = cleanString(payload.processType)
  const editMode = cleanString(payload.editMode)
  const maskImage = cleanString(payload.maskImage)
  const maskMaterialId = cleanString(payload.maskMaterialId)

  if (processType !== CANVAS_IMAGE_EDIT_PROCESS_TYPE) {
    if (editMode || maskImage || maskMaterialId) {
      throw new Error('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID: mask fields require processType=image_edit')
    }
    return null
  }
  if (editMode !== CANVAS_IMAGE_EDIT_MODE) {
    throw new Error('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID: image_edit requires editMode=inpaint')
  }
  if (!maskImage) {
    throw new Error('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID: image_edit requires maskImage')
  }
  if (!maskMaterialId) {
    throw new Error('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID: image_edit requires maskMaterialId')
  }
  return {
    processType: CANVAS_IMAGE_EDIT_PROCESS_TYPE,
    editMode: CANVAS_IMAGE_EDIT_MODE,
    maskImage,
    maskMaterialId,
  }
}

