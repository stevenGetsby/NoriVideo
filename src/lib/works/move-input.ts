import { ApiError } from '@/lib/api-errors'

function readWorkIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => (
    typeof id !== 'string' || !id.trim() || id.trim().length > 191
  ))) {
    throw new ApiError('INVALID_PARAMS', { message: '作品列表必须由有效的作品 ID 组成。' })
  }
  return Array.from(new Set(value.map((id: string) => id.trim())))
}

function readTargetId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 191) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择有效的目标项目。' })
  }
  return value.trim()
}

/** New and legacy fields must describe the same move, never pick one silently. */
export function normalizeMoveWorkInput(input: {
  workIds?: unknown
  projectIds?: unknown
  targetProjectId?: unknown
  targetWorkId?: unknown
}) {
  const currentIds = input.workIds === undefined ? null : readWorkIds(input.workIds)
  const legacyIds = input.projectIds === undefined ? null : readWorkIds(input.projectIds)
  if (currentIds && legacyIds) {
    const legacySet = new Set(legacyIds)
    if (currentIds.length !== legacyIds.length || currentIds.some((id) => !legacySet.has(id))) {
      throw new ApiError('INVALID_PARAMS', { message: '新旧字段中的作品列表不一致，请重新选择作品。' })
    }
  }
  const currentTarget = input.targetProjectId === undefined ? null : readTargetId(input.targetProjectId)
  const legacyTarget = input.targetWorkId === undefined ? null : readTargetId(input.targetWorkId)
  if (currentTarget && legacyTarget && currentTarget !== legacyTarget) {
    throw new ApiError('INVALID_PARAMS', { message: '目标项目不一致，请重新选择项目。' })
  }
  const workIds = currentIds ?? legacyIds ?? []
  const targetProjectId = currentTarget ?? legacyTarget
  if (!workIds.length || !targetProjectId) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择作品和目标项目。' })
  }
  return { workIds, targetProjectId }
}
