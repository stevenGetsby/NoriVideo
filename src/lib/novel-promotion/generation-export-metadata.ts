import { prisma } from '@/lib/prisma'
import { extractStorageKey } from '@/lib/storage'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown) { return typeof value === 'string' ? value.trim() : '' }
function contains(value: unknown, identity: string): boolean {
  if (typeof value === 'string') return (extractStorageKey(value) || value) === identity
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some((item) => contains(item, identity))
}

/** Historical exports must attribute to the generating actor, never downloader. */
export async function resolveGenerationExportMetadata(projectId: string, source: string) {
  const identity = extractStorageKey(source) || source
  const material = await prisma.frameosMaterial.findFirst({
    where: { projectId, type: 'video', OR: [{ storageKey: identity }, { resultUrl: source }, { resultUrl: identity }] },
    select: { ownerName: true },
  })
  const tasks = await prisma.task.findMany({
    where: { projectId, status: 'completed' },
    select: { id: true, userId: true, targetId: true, type: true, payload: true, result: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const matched = tasks.find((task) => contains(task.result, identity))
  if (!matched) return { creatorName: material?.ownerName || '未记录创建者', generationIndex: null }
  const payload = record(matched.payload)
  const actorId = text(record(payload.meta).quotaUserId) || matched.userId
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
  const generationIndex = tasks.filter((task) => task.targetId === matched.targetId && task.type === matched.type && task.createdAt <= matched.createdAt).length
  return { creatorName: material?.ownerName || text(payload.ownerName) || actor?.name || '未记录创建者', generationIndex: Math.max(1, generationIndex) }
}
