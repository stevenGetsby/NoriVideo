import { Prisma } from '@prisma/client'
import type { FrameosAssetCategory } from './material-category'
import { characterVoiceMaterialId } from './character-voice-reference'
import { supersededByMaterialId } from './material-supersede'

type MaterialPageQuery = {
  where: Prisma.FrameosMaterialWhereInput
  orderBy: Prisma.FrameosMaterialOrderByWithRelationInput[]
  take: number
  cursor?: { id: string }
  skip?: number
}

function frameosMaterialPageWhere(
  where: Prisma.FrameosMaterialWhereInput,
  ascending: boolean,
  cursor: { id: string; createdAt: Date } | null,
): Prisma.FrameosMaterialWhereInput {
  if (!cursor) return where
  const compare = ascending ? 'gt' : 'lt'
  return { AND: [where, { OR: [
    { createdAt: { [compare]: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { [compare]: cursor.id } },
  ] }] }
}

/** Fill the lookahead page with visible rows without dropping a run of retired rows. */
export async function readFrameosVisibleMaterialPage<T extends { id: string; createdAt: Date; metadata: unknown }>(
  input: {
    where: Prisma.FrameosMaterialWhereInput
    ascending: boolean
    limit: number
    cursor?: { id: string; createdAt: Date | null }
  },
  findMany: (query: MaterialPageQuery) => Promise<T[]>,
): Promise<T[]> {
  const { where, ascending, limit, cursor } = input
  const sort = ascending ? 'asc' : 'desc'
  const orderBy: MaterialPageQuery['orderBy'] = [{ createdAt: sort }, { id: sort }]
  const take = limit + 1
  const visible: T[] = []
  let after = cursor?.createdAt ? { id: cursor.id, createdAt: cursor.createdAt } : null
  let legacyCursor = after ? undefined : cursor?.id
  while (visible.length < take) {
    const batch = await findMany({
      where: frameosMaterialPageWhere(where, ascending, after),
      orderBy,
      take,
      ...(legacyCursor ? { cursor: { id: legacyCursor }, skip: 1 } : {}),
    })
    for (const material of batch) {
      if (!supersededByMaterialId(material.metadata)) visible.push(material)
      if (visible.length === take) break
    }
    const last = batch.at(-1)
    if (!last || batch.length < take) break
    after = { id: last.id, createdAt: last.createdAt }
    legacyCursor = undefined
  }
  return visible
}

const ORIGIN_TYPES: Record<Exclude<FrameosAssetCategory, 'other'>, string[]> = {
  character: ['character'],
  location: ['location', 'environment'],
  prop: ['prop', 'item'],
  shot: ['panel', 'shot', 'video'],
}

const originMatches = (values: string[]): Prisma.FrameosMaterialWhereInput[] => values.map((value) => ({
  metadata: { path: '$.originType', string_contains: value },
}))

export function frameosAssetCategoryWhere(category: FrameosAssetCategory): Prisma.FrameosMaterialWhereInput {
  const pinned = (value: string): Prisma.FrameosMaterialWhereInput => ({ metadata: { path: '$.assetCategory', equals: value } })
  if (category !== 'other') {
    return { OR: [
      pinned(category),
      { AND: [
        { metadata: { path: '$.assetCategory', equals: Prisma.AnyNull } },
        { OR: originMatches(ORIGIN_TYPES[category]) },
      ] },
    ] }
  }
  return { OR: [
    pinned('other'),
    { AND: [
      { metadata: { path: '$.assetCategory', equals: Prisma.AnyNull } },
      { OR: [
        { metadata: { path: '$.originType', equals: Prisma.AnyNull } },
        ...Object.values(ORIGIN_TYPES).flat().map((value) => ({ NOT: originMatches([value])[0] })),
      ] },
    ] },
  ] }
}

export function frameosMissingVoiceWhere(voiceIds: ReadonlySet<string>): Prisma.FrameosMaterialWhereInput {
  return { OR: [
    { metadata: { path: '$.voiceMaterialId', equals: Prisma.AnyNull } },
    { metadata: { path: '$.voiceMaterialId', equals: '' } },
    ...(voiceIds.size > 0 ? [{ metadata: { path: '$.voiceMaterialId', notIn: [...voiceIds] } } as Prisma.FrameosMaterialWhereInput] : []),
  ] }
}


export async function resolveFrameosVoiceIds(
  where: Prisma.FrameosMaterialWhereInput,
  findMany: (args: { where: Prisma.FrameosMaterialWhereInput; select: { id: true; metadata: true } }) => Promise<Array<{ id: string; metadata?: unknown }>>,
) {
  const characters = await findMany({ where, select: { id: true, metadata: true } })
  const ids = [...new Set(characters.map((row) => characterVoiceMaterialId(row.metadata)).filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return new Set<string>()
  const voices = await findMany({ where: { ...where, id: { in: ids }, type: 'audio', status: 'ready', deletedAt: null }, select: { id: true, metadata: true } })
  return new Set(voices.map((voice) => voice.id))
}
