import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MpApiError } from '../errors'
import { isShareId } from '../ids'
import { mergeSaveState } from '../save-merge'
import type { DyAppRow } from './apps'
import { DY_USER_SELECT, type DyUserRow } from './auth'
import type { DySession } from './session'

const toJson = (value: unknown) => value as unknown as Prisma.InputJsonValue

// 与 library.ts 的 isP2002 同款；那个是私有的，§0.2 不允许改 library.ts。
function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export interface DyLoginAttr { source: string | null; shareId: string | null }

async function run(app: DyAppRow, s: DySession, attr: DyLoginAttr): Promise<{ user: DyUserRow; isNew: boolean; merged: boolean }> {
  const a = s.openid
    ? await prisma.dyUser.findUnique({ where: { appId_openid: { appId: app.appId, openid: s.openid } }, select: DY_USER_SELECT })
    : null
  const b = s.anonOpenid
    ? await prisma.dyUser.findUnique({ where: { appId_anonOpenid: { appId: app.appId, anonOpenid: s.anonOpenid } }, select: DY_USER_SELECT })
    : null
  if (a?.status === 'banned' || b?.status === 'banned') throw new MpApiError('MP_USER_BANNED')

  // 同一个玩家先匿名玩、后来登录了抖音：一个事务里把 B 合并进 A。
  if (a && b && a.id !== b.id) {
    await prisma.$transaction(async (tx) => {
      const saveB = await tx.dySave.findUnique({ where: { userId: b.id } })
      if (saveB) {
        const saveA = await tx.dySave.findUnique({ where: { userId: a.id } })
        if (!saveA) {
          await tx.dySave.update({ where: { id: saveB.id }, data: { userId: a.id } })
        } else {
          const state = mergeSaveState(saveA, saveB)
          await tx.dySave.update({
            where: { id: saveA.id },
            data: { profile: toJson(state.profile), saves: toJson(state.saves), permanent: toJson(state.permanent), rev: saveA.rev + 1 },
          })
          await tx.dySave.delete({ where: { id: saveB.id } })
        }
      }
      await tx.dyUser.update({ where: { id: b.id }, data: { status: 'merged', anonOpenid: null, tokenVersion: { increment: 1 } } })
      await tx.dyUser.update({ where: { id: a.id }, data: { anonOpenid: s.anonOpenid } })
    })
    const user = await prisma.dyUser.findUnique({ where: { id: a.id }, select: DY_USER_SELECT })
    if (!user) throw new MpApiError('MP_UNAUTHORIZED')
    return { user, isNew: false, merged: true }
  }

  if (a) {
    const data: { anonOpenid?: string; unionid?: string } = {}
    if (!a.anonOpenid && s.anonOpenid) data.anonOpenid = s.anonOpenid
    if (!a.unionid && s.unionid) data.unionid = s.unionid
    const user = Object.keys(data).length ? await prisma.dyUser.update({ where: { id: a.id }, data, select: DY_USER_SELECT }) : a
    return { user, isNew: false, merged: false }
  }

  if (b) {
    // 只有匿名行且这次带了 openid：直接升级。
    if (s.openid) {
      const data: { openid: string; unionid?: string } = { openid: s.openid }
      if (!b.unionid && s.unionid) data.unionid = s.unionid
      const user = await prisma.dyUser.update({ where: { id: b.id }, data, select: DY_USER_SELECT })
      return { user, isNew: false, merged: false }
    }
    return { user: b, isNew: false, merged: false }
  }

  const shareId = attr.shareId && isShareId(attr.shareId) ? attr.shareId : null
  const user = await prisma.dyUser.create({
    data: { appId: app.appId, openid: s.openid, anonOpenid: s.anonOpenid, unionid: s.unionid, firstSource: attr.source, firstShareId: shareId },
    select: DY_USER_SELECT,
  })
  // 归因尽力而为：分享计数失败不阻断登录。
  if (shareId) await prisma.dyShare.updateMany({ where: { id: shareId }, data: { newUsers: { increment: 1 } } }).catch(() => undefined)
  return { user, isNew: true, merged: false }
}

export async function loginDyUser(app: DyAppRow, s: DySession, attr: DyLoginAttr): Promise<{ user: DyUserRow; isNew: boolean; merged: boolean }> {
  try {
    return await run(app, s, attr)
  } catch (error) {
    // 撞上唯一约束（并发创建）时重新查询一次，第二遍自然走已有用户/合并分支。
    if (isP2002(error)) return run(app, s, attr)
    throw error
  }
}