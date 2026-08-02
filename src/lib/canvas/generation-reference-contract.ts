export const CANVAS_GENERATION_REFERENCE_ROLES = [
  'REF',
  'FIRST_FRAME',
  'LAST_FRAME',
] as const

export type CanvasGenerationReferenceRole = (typeof CANVAS_GENERATION_REFERENCE_ROLES)[number]

export type CanvasGenerationMaterialReference = {
  materialId: string
  role: CanvasGenerationReferenceRole
}

type ReferenceContractResult =
  | { success: true; references: CanvasGenerationMaterialReference[] }
  | { success: false; message: string }

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseExplicitReferences(
  value: unknown,
  limit: number,
): ReferenceContractResult | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length > limit) {
    return { success: false, message: `参考素材角色列表格式无效或超过 ${limit} 个。` }
  }
  const references: CanvasGenerationMaterialReference[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { success: false, message: '参考素材角色列表格式无效。' }
    }
    const source = item as Record<string, unknown>
    const materialId = text(source.materialId)
    const role = text(source.role)
    if (!materialId || materialId.length > 191 || !(CANVAS_GENERATION_REFERENCE_ROLES as readonly string[]).includes(role)) {
      return { success: false, message: '参考素材必须包含有效的 materialId 和 role。' }
    }
    if (ids.has(materialId)) {
      return { success: false, message: '同一参考素材不能承担多个生成角色。' }
    }
    ids.add(materialId)
    references.push({ materialId, role: role as CanvasGenerationReferenceRole })
  }
  return { success: true, references }
}

/**
 * Normalize the API contract while retaining ordinary-reference backwards
 * compatibility. First/last-frame requests intentionally require explicit
 * roles; positional arrays are too easy to reorder across persistence and
 * queue boundaries.
 */
export function normalizeCanvasGenerationMaterialReferences(input: {
  value: unknown
  legacyMaterialIds: string[]
  inputMode: string
  limit: number
}): ReferenceContractResult {
  const explicit = parseExplicitReferences(input.value, input.limit)
  if (explicit && !explicit.success) return explicit
  const references = explicit?.references
    || input.legacyMaterialIds.slice(0, input.limit).map((materialId) => ({
      materialId,
      role: 'REF' as const,
    }))

  if (explicit && input.legacyMaterialIds.length > 0) {
    const explicitIds = references.map((item) => item.materialId)
    if (
      explicitIds.length !== input.legacyMaterialIds.length
      || explicitIds.some((id, index) => id !== input.legacyMaterialIds[index])
    ) {
      return { success: false, message: 'referenceMaterials 与 referenceMaterialIds 不一致。' }
    }
  }

  if (input.inputMode === 'firstlastframe') {
    if (!explicit) {
      return { success: false, message: '首尾帧模式必须显式标记 FIRST_FRAME 和 LAST_FRAME。' }
    }
    if (
      references.length !== 2
      || references[0]?.role !== 'FIRST_FRAME'
      || references[1]?.role !== 'LAST_FRAME'
    ) {
      return { success: false, message: '首尾帧模式必须依次包含一个 FIRST_FRAME 和一个 LAST_FRAME。' }
    }
  } else if (references.some((item) => item.role !== 'REF')) {
    return { success: false, message: 'FIRST_FRAME/LAST_FRAME 角色只能用于首尾帧模式。' }
  }

  return { success: true, references }
}

export function buildCanvasGenerationMaterialReferences(
  materialIds: string[],
  inputMode: string,
): CanvasGenerationMaterialReference[] {
  return materialIds.map((materialId, index) => ({
    materialId,
    role: inputMode === 'firstlastframe'
      ? index === 0 ? 'FIRST_FRAME' : 'LAST_FRAME'
      : 'REF',
  }))
}
