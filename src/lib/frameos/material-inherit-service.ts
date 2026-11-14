import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { getWorkspaceActor, projectReadWhere, workspaceUserWhere } from '@/lib/collaboration/access'
import { characterVoiceMaterialId } from './character-voice-reference'
import { ACCOUNT_MATERIAL_PROJECT_IDS } from './material-access'
import { inheritedMaterialMetadata, MAX_INHERITED_MATERIALS } from './material-inherit'
import { supersededByMaterialId } from './material-supersede'

export interface InheritAssetsRequest {
  sourceProjectId: string
  materialIds: string[]
}

export interface InheritedAssetsSummary {
  sourceProjectId: string
  sourceProjectName: string
  copied: number
  voicesCopied: number
  voicesDropped: number
}

function invalid(code: string, message: string): never {
  throw new ApiError('INVALID_PARAMS', { code, message })
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

/**
 * Multipart bodies carry the id list as a JSON string, JSON bodies as an
 * array. Returns null when the request does not ask to inherit anything.
 */
export function readInheritAssetsRequest(rawBody: Record<string, unknown>): InheritAssetsRequest | null {
  const sourceValue = rawBody.inheritSourceProjectId
  const sourceProjectId = typeof sourceValue === 'string' ? sourceValue.trim() : ''
  let ids: unknown = rawBody.inheritMaterialIds
  const hasIds = ids !== undefined && ids !== null && ids !== ''
  if (!sourceProjectId && !hasIds) return null
  if (!sourceProjectId) invalid('INHERIT_SOURCE_REQUIRED', '请选择要继承资产的作品。')
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids)
    } catch {
      invalid('INHERIT_MATERIALS_INVALID', '继承的资产列表格式不正确。')
    }
  }
  if (!Array.isArray(ids) || ids.length > MAX_INHERITED_MATERIALS * 5 || ids.some((id) => typeof id !== 'string')) {
    invalid('INHERIT_MATERIALS_INVALID', '继承的资产列表格式不正确。')
  }
  const materialIds = [...new Set((ids as string[]).map((id) => id.trim()).filter(Boolean))]
  if (materialIds.length === 0) invalid('INHERIT_MATERIALS_REQUIRED', '请至少选择一项要继承的资产。')
  if (materialIds.length > MAX_INHERITED_MATERIALS) {
    invalid('INHERIT_MATERIALS_LIMIT', `一次最多继承 ${MAX_INHERITED_MATERIALS} 项资产。`)
  }
  return { sourceProjectId, materialIds }
}

/**
 * Copies shared library rows of another readable 作品 into a freshly created
 * one. A copy is an independent row that shares the stored file, so deleting,
 * renaming or replacing it never touches the original. Every id is re-checked
 * against the source's shared, ready rows: the client only proposes ids.
 */
export async function inheritMaterialsIntoProject(
  tx: Prisma.TransactionClient,
  input: { session: AuthSession; request: InheritAssetsRequest; targetProjectId: string },
): Promise<InheritedAssetsSummary> {
  const { session, request, targetProjectId } = input
  const actor = getWorkspaceActor(session)
  const source = await tx.project.findFirst({
    where: projectReadWhere(session, request.sourceProjectId),
    select: { id: true, name: true },
  })
  if (!source) throw new ApiError('NOT_FOUND', { message: '要继承资产的作品不存在或当前账号无权访问。' })

  const workspaceUsers = await tx.user.findMany({
    where: workspaceUserWhere(actor.workspaceOwnerId),
    select: { id: true },
  })
  const workspaceUserIds = workspaceUsers.map((user) => user.id)
  const rows = await tx.frameosMaterial.findMany({
    where: {
      id: { in: request.materialIds },
      userId: { in: workspaceUserIds },
      projectId: source.id,
      personalOwnerId: null,
      deletedAt: null,
      status: 'ready',
    },
  })
  // A retired picture only survives for canvases that still point at it.
  const selected = rows.filter((row) => !supersededByMaterialId(row.metadata))
  if (selected.length !== request.materialIds.length) {
    invalid('INHERIT_MATERIALS_UNAVAILABLE', '所选资产已被删除或无法继承，请重新选择后再创建。')
  }

  const copyIds = new Map(selected.map((row) => [row.id, randomUUID()]))
  const voiceIds = [...new Set(selected
    .map((row) => characterVoiceMaterialId(row.metadata))
    .filter((id): id is string => Boolean(id)))]
  // Only voices every member of the new 作品 can reach may stay bound: the
  // source 作品's own audio (copied along) and account-wide audio (kept as is).
  // Personal voices and voices of other 作品 would dangle, so the binding is dropped.
  const voices = voiceIds.length > 0
    ? await tx.frameosMaterial.findMany({
      where: {
        id: { in: voiceIds },
        userId: { in: workspaceUserIds },
        type: 'audio',
        status: 'ready',
        deletedAt: null,
        personalOwnerId: null,
        projectId: { in: [source.id, ...ACCOUNT_MATERIAL_PROJECT_IDS] },
      },
    })
    : []
  const voicesById = new Map(voices.map((voice) => [voice.id, voice]))
  const carriedVoices: typeof voices = []
  let voicesDropped = 0
  const voiceFor = (metadata: unknown): string | null => {
    const voiceId = characterVoiceMaterialId(metadata)
    if (!voiceId) return null
    const voice = voicesById.get(voiceId)
    if (!voice) {
      voicesDropped += 1
      return null
    }
    if (voice.projectId !== source.id) return voice.id
    let copyId = copyIds.get(voice.id)
    if (!copyId) {
      copyId = randomUUID()
      copyIds.set(voice.id, copyId)
      carriedVoices.push(voice)
    }
    return copyId
  }

  const copies = selected.map((row) => ({ row, voiceMaterialId: voiceFor(row.metadata) }))
  const ordered = [...copies, ...carriedVoices.map((row) => ({ row, voiceMaterialId: null }))]
    .sort((left, right) => left.row.createdAt.getTime() - right.row.createdAt.getTime() || left.row.id.localeCompare(right.row.id))

  // Libraries list newest first; strictly increasing times keep the source's order.
  const base = Date.now()
  const ownerName = session.user.name?.replace(/\s+/g, ' ').trim() || null
  await tx.frameosMaterial.createMany({
    data: ordered.map(({ row, voiceMaterialId }, index) => ({
      id: copyIds.get(row.id) as string,
      userId: actor.workspaceOwnerId,
      projectId: targetProjectId,
      personalOwnerId: null,
      ownerName: ownerName || row.ownerName,
      title: row.title,
      type: row.type,
      source: row.source,
      status: 'ready',
      resultUrl: row.resultUrl,
      storageKey: row.storageKey,
      isSuperresolved: row.isSuperresolved,
      isSubtitleErased: row.isSubtitleErased,
      createdAt: new Date(base + index),
      metadata: toJson(inheritedMaterialMetadata(
        row.metadata,
        { projectId: source.id, projectName: source.name, materialId: row.id },
        voiceMaterialId,
      )),
    })),
  })

  return {
    sourceProjectId: source.id,
    sourceProjectName: source.name,
    copied: selected.length,
    voicesCopied: carriedVoices.length,
    voicesDropped,
  }
}
