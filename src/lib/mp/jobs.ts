import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { goLive, type MpNotifyKind } from './release/lifecycle'
import { sendSubscribe } from './wx'

const logger = createScopedLogger({ module: 'mp-jobs' })

const NOTIFY_HINT: Record<MpNotifyKind, string> = {
  work_live: '你预约的作品已上线，快来开始游玩',
  chapter_update: '新章节已上线，快来继续你的故事',
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function templateOf(kind: MpNotifyKind): { id: string; fields: { title: string; hint: string; time: string } } | null {
  const id = (kind === 'work_live' ? process.env.MP_TPL_WORK_LIVE : process.env.MP_TPL_CHAPTER_UPDATE)?.trim()
  const raw = (kind === 'work_live' ? process.env.MP_TPL_WORK_LIVE_FIELDS : process.env.MP_TPL_CHAPTER_UPDATE_FIELDS)?.trim()
  if (!id || !raw) return null
  try {
    const fields = JSON.parse(raw) as Record<string, unknown>
    if (typeof fields.title !== 'string' || typeof fields.hint !== 'string' || typeof fields.time !== 'string') return null
    return { id, fields: { title: fields.title, hint: fields.hint, time: fields.time } }
  } catch {
    return null
  }
}

export function formatLiveTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function withJobLock(key: string, ttlSec: number, run: () => Promise<void>): Promise<void> {
  const locked = await redis.set(key, '1', 'EX', ttlSec, 'NX')
  if (locked !== 'OK') return
  try {
    await run()
  } finally {
    await redis.del(key).catch(() => undefined)
  }
}

export async function runScheduledGoLive(): Promise<void> {
  await withJobLock('mp:job:golive', 60, async () => {
    const due = await prisma.mpWork.findMany({
      where: { pendingReleaseId: { not: null }, scheduledAt: { lte: new Date() } },
      select: { id: true, pendingReleaseId: true },
      take: 20,
    })
    for (const work of due) {
      if (!work.pendingReleaseId) continue
      try {
        await goLive(work.pendingReleaseId)
        logger.info({ action: 'mp.golive.done', message: '定时上线完成', details: { mpWorkId: work.id } })
      } catch (error) {
        logger.warn({ action: 'mp.golive.failed', message: '定时上线失败', details: { mpWorkId: work.id, error: error instanceof Error ? error.message : String(error) } })
      }
    }
  })
}

interface NotifyItem { kind: MpNotifyKind; mpWorkId: string; releaseId: string }

async function processNotifyItem(item: NotifyItem): Promise<void> {
  const template = templateOf(item.kind)
  const work = await prisma.mpWork.findUnique({ where: { id: item.mpWorkId }, select: { id: true, slug: true, title: true } })
  if (!template || !work) {
    logger.warn({ action: 'mp.notify.skipped', message: '订阅消息模板未配置或作品不存在', details: { kind: item.kind, mpWorkId: item.mpWorkId } })
    return
  }
  const release = await prisma.storyRelease.findUnique({ where: { id: item.releaseId }, select: { liveAt: true } })
  const timeText = formatLiveTime(release?.liveAt ?? new Date())
  const title = [...work.title].slice(0, 20).join('')
  const page = `pages/work/index?w=${encodeURIComponent(work.slug)}&src=subscribe`
  let cursor: string | null = null
  for (;;) {
    const rows: { id: string; consumerId: string }[] = await prisma.mpSubscription.findMany({
      where: { mpWorkId: item.mpWorkId, kind: item.kind, credits: { gt: 0 }, OR: [{ lastSentRef: null }, { lastSentRef: { not: item.releaseId } }] },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, consumerId: true },
    })
    if (!rows.length) break
    for (const row of rows) {
      const consumer = await prisma.consumerUser.findUnique({ where: { id: row.consumerId }, select: { openid: true } })
      if (consumer) {
        const result = await sendSubscribe(consumer.openid, template.id, page, {
          [template.fields.title]: { value: title },
          [template.fields.hint]: { value: NOTIFY_HINT[item.kind] },
          [template.fields.time]: { value: timeText },
        })
        if (result.errcode === 0 || result.errcode === 43101) {
          await prisma.mpSubscription.update({ where: { id: row.id }, data: { credits: { decrement: 1 }, lastSentRef: item.releaseId } })
        } else {
          logger.warn({ action: 'mp.notify.send_failed', message: '订阅消息发送失败', details: { subscriptionId: row.id, errcode: result.errcode } })
        }
      }
      await sleep(50)
    }
    cursor = rows[rows.length - 1].id
    if (rows.length < 200) break
  }
}

export async function sendNotifications(): Promise<void> {
  await withJobLock('mp:job:notify', 300, async () => {
    // 一次 tick 只处理一个队列项；处理完才 LPOP，中途崩溃靠 lastSentRef 防重复。
    const raw = await redis.lindex('mp:notify:queue', 0)
    if (!raw) return
    let item: NotifyItem
    try {
      const parsed = JSON.parse(raw) as Partial<NotifyItem>
      if ((parsed.kind !== 'work_live' && parsed.kind !== 'chapter_update') || typeof parsed.mpWorkId !== 'string' || typeof parsed.releaseId !== 'string') {
        await redis.lpop('mp:notify:queue')
        return
      }
      item = { kind: parsed.kind, mpWorkId: parsed.mpWorkId, releaseId: parsed.releaseId }
    } catch {
      await redis.lpop('mp:notify:queue')
      return
    }
    try {
      await processNotifyItem(item)
    } finally {
      await redis.lpop('mp:notify:queue')
    }
  })
}

export async function runMpJobs(): Promise<void> {
  if (process.env.MP_JOBS_ENABLED?.trim() !== '1') return
  try {
    await runScheduledGoLive()
  } catch (error) {
    logger.warn({ action: 'mp.jobs.golive_failed', message: '定时上线任务失败', details: { error: error instanceof Error ? error.message : String(error) } })
  }
  try {
    await sendNotifications()
  } catch (error) {
    logger.warn({ action: 'mp.jobs.notify_failed', message: '订阅消息任务失败', details: { error: error instanceof Error ? error.message : String(error) } })
  }
}
