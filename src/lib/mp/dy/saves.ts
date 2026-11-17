import { Prisma } from '@prisma/client'
import { emptyProfile } from '@/lib/interactive/achievements'
import { emptySaves } from '@/lib/interactive/saves'
import { prisma } from '@/lib/prisma'
import { MpApiError } from '../errors'
import type { SavePutBody } from '../library'
import { mergeSaveState, normalizeSaveState, type SaveState } from '../save-merge'
import { getDyApp } from './apps'
import type { DyUserRow } from './auth'

const toJson = (value: unknown) => value as unknown as Prisma.InputJsonValue

// 与 library.ts 的 isP2002/withCreateRetry 同款；那两个是私有的，§0.2 不允许改 library.ts。
function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function withCreateRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (isP2002(error)) return run()
    throw error
  }
}

function readProgress(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function readEndingsGot(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

export async function getDySave(user: DyUserRow) {
  const row = await prisma.dySave.findUnique({ where: { userId: user.id } })
  if (!row) return { rev: 0, releaseId: null, profile: emptyProfile(), saves: emptySaves(), permanent: {} }
  return { rev: row.rev, releaseId: row.releaseId, profile: row.profile, saves: row.saves, permanent: row.permanent }
}

export async function putDySave(user: DyUserRow, body: SavePutBody): Promise<SaveState & { rev: number; merged: boolean }> {
  const baseRev = body.baseRev
  if (typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0) throw new MpApiError('MP_VALIDATION', { message: '存档版本无效' })
  const releaseId = typeof body.releaseId === 'string' ? body.releaseId.trim() : ''
  if (!releaseId) throw new MpApiError('MP_VALIDATION', { message: '缺少版本信息' })
  const app = await getDyApp(user.appId)
  if (!app.releaseIds.includes(releaseId)) throw new MpApiError('MP_VALIDATION', { message: '版本不在白名单' })
  const client = normalizeSaveState(body)
  const progress = readProgress(body.progress)
  const endingsGot = readEndingsGot(body.endingsGot)
  const where = { userId: user.id }

  const outcome = await withCreateRetry(() => prisma.$transaction(async (tx) => {
    const row = await tx.dySave.findUnique({ where })
    if (!row) {
      await tx.dySave.create({
        data: { userId: user.id, appId: user.appId, releaseId, profile: toJson(client.profile), saves: toJson(client.saves), permanent: toJson(client.permanent), rev: 1, progress, endingsGot },
      })
      // 与微信端的唯一计数差异：不增加 playerCount（N8）。
      return { rev: 1, state: client, merged: false }
    }
    const merged = baseRev !== row.rev
    const state = merged ? mergeSaveState(row, body) : client
    const rev = row.rev + 1
    await tx.dySave.update({
      where: { id: row.id },
      data: { releaseId, profile: toJson(state.profile), saves: toJson(state.saves), permanent: toJson(state.permanent), rev, progress, endingsGot, lastPlayedAt: new Date() },
    })
    return { rev, state, merged }
  }))

  return { rev: outcome.rev, profile: outcome.state.profile, saves: outcome.state.saves, permanent: outcome.state.permanent, merged: outcome.merged }
}