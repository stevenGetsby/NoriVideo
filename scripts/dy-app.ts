// 抖音小游戏 app 运维（N13）。用法：npx tsx scripts/dy-app.ts <cmd> [...]
// DB/存储连接沿用现有脚本：dotenv 读 .env / .env.local（运行时读取，不打印任何凭证）。
// secret 只走 set-secret 的 stdin（不回显），绝不接受命令行参数，绝不打印。
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import dotenv from 'dotenv'
import type { PrismaClient } from '@prisma/client'

dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

const DAY_MS = 24 * 3600 * 1000
const BEIJING_OFFSET_MS = 8 * 3600 * 1000
const PLAYABLE_STATUS = new Set(['approved', 'live', 'retired'])
const RELEASE_IDS_MAX = 10
const STATS_DAYS_MAX = 90 // 与 MP_EVENT_RETENTION_DAYS 一致，更早的事件已被清理

let db: PrismaClient

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

function arg(index: number, label: string): string {
  const value = process.argv[3 + index]?.trim()
  if (!value) fail(`缺少参数：${label}`)
  return value
}

async function appOrDie(appId: string) {
  const app = await db.dyApp.findUnique({ where: { appId } })
  if (!app) fail(`app 不存在：${appId}`)
  return app
}

function releaseIdsOf(app: { releaseIds: unknown }): string[] {
  return Array.isArray(app.releaseIds) ? app.releaseIds.filter((item): item is string => typeof item === 'string') : []
}

async function invalidateAppCache(): Promise<void> {
  const { clearDyAppCache } = await import('@/lib/mp/dy/apps')
  await clearDyAppCache()
}

/** read -s 风格：TTY 下逐字符读、不回显；管道输入时整段读。控制字符用 charCode 判断。 */
function readSecretFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      let data = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (chunk: string) => { data += chunk })
      stdin.on('end', () => resolve(data.trim()))
      stdin.on('error', reject)
      return
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let secret = ''
    const finish = (cancelled: boolean) => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write('\n')
      if (cancelled) process.exit(1)
      resolve(secret)
    }
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0)
        if (code === 13 || code === 10) return finish(false) // Enter
        if (code === 3) return finish(true) // Ctrl-C
        if (code === 127 || code === 8) { secret = secret.slice(0, -1); continue } // Backspace
        if (code < 32) continue // 其余控制字符忽略
        secret += ch
      }
    }
    stdin.on('data', onData)
    stdin.on('error', (error) => {
      stdin.setRawMode(false)
      reject(error)
    })
  })
}

async function cmdAdd(): Promise<void> {
  const appId = arg(0, 'appId')
  const slug = arg(1, 'mpWorkSlug')
  const name = arg(2, 'name')
  if (appId.length > 32) fail('appId 超长（最多 32 字符）')
  if (name.length > 40) fail('name 超长（最多 40 字符）')
  const work = await db.mpWork.findUnique({ where: { slug } })
  if (!work) fail(`作品不存在：${slug}`)
  const existing = await db.dyApp.findUnique({ where: { appId } })
  if (existing) fail(`app 已存在：${appId}`)
  await db.dyApp.create({ data: { appId, mpWorkId: work.id, name, secretEnc: '', status: 'active', releaseIds: [] } })
  out(`已创建 ${appId}（作品 ${slug}，status active，白名单为空；下一步 set-secret）`)
}

async function cmdSetSecret(): Promise<void> {
  const appId = arg(0, 'appId')
  await appOrDie(appId)
  process.stdout.write('请输入 appSecret（不回显）：')
  const secret = await readSecretFromStdin()
  if (!secret) fail('secret 不能为空')
  const { encryptApiKey } = await import('@/lib/crypto-utils')
  await db.dyApp.update({ where: { appId }, data: { secretEnc: encryptApiKey(secret) } })
  out('secret 已加密写入')
}

async function cmdAllow(): Promise<void> {
  const appId = arg(0, 'appId')
  const releaseId = arg(1, 'releaseId')
  const app = await appOrDie(appId)
  const release = await db.storyRelease.findUnique({ where: { id: releaseId } })
  if (!release) fail(`release 不存在：${releaseId}`)
  const work = await db.mpWork.findUnique({ where: { id: app.mpWorkId } })
  if (!work) fail(`app 关联的作品不存在：${app.mpWorkId}`)
  if (release.workId !== work.workId) fail('release 不属于该作品')
  if (!PLAYABLE_STATUS.has(release.status)) fail(`release 状态不可玩：${release.status}`)
  if (!release.programKey || !release.programHash || !release.manifest || !release.meta) fail('release 产物不齐全（programKey/programHash/manifest/meta）')
  const ids = releaseIdsOf(app)
  if (ids.includes(releaseId)) {
    out('已在白名单')
    return
  }
  if (ids.length >= RELEASE_IDS_MAX) fail(`白名单最多 ${RELEASE_IDS_MAX} 个`)
  await db.dyApp.update({ where: { appId }, data: { releaseIds: [...ids, releaseId] } })
  await invalidateAppCache()
  out(`已加入白名单（${ids.length + 1}/${RELEASE_IDS_MAX}）`)
}

async function cmdRevoke(): Promise<void> {
  const appId = arg(0, 'appId')
  const releaseId = arg(1, 'releaseId')
  const app = await appOrDie(appId)
  const ids = releaseIdsOf(app)
  if (!ids.includes(releaseId)) {
    out('不在白名单')
    return
  }
  await db.dyApp.update({ where: { appId }, data: { releaseIds: ids.filter((id) => id !== releaseId) } })
  await invalidateAppCache()
  out('已移出白名单')
}

async function cmdStatus(status: 'active' | 'offline'): Promise<void> {
  const appId = arg(0, 'appId')
  await appOrDie(appId)
  await db.dyApp.update({ where: { appId }, data: { status } })
  await invalidateAppCache()
  out(status === 'active' ? '已上线（active）' : '已下线（offline）')
}

async function cmdStats(): Promise<void> {
  const appId = arg(0, 'appId')
  await appOrDie(appId)
  const daysRaw = process.argv[4]?.trim()
  const days = daysRaw ? Number.parseInt(daysRaw, 10) : 7
  if (!Number.isFinite(days) || days < 1 || days > STATS_DAYS_MAX) fail(`days 需为 1-${STATS_DAYS_MAX} 的整数`)
  const todayStart = Math.floor((Date.now() + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS
  out('date        newUsers  app_launch  play_start  ending_reached  shareNewUsers')
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = new Date(todayStart - i * DAY_MS)
    const end = new Date(start.getTime() + DAY_MS)
    const range = { gte: start, lt: end }
    const [newUsers, launches, plays, endings, shareNewUsers] = await Promise.all([
      db.dyUser.count({ where: { appId, createdAt: range } }),
      db.dyEvent.count({ where: { appId, name: 'app_launch', createdAt: range } }),
      db.dyEvent.count({ where: { appId, name: 'play_start', createdAt: range } }),
      db.dyEvent.count({ where: { appId, name: 'ending_reached', createdAt: range } }),
      db.dyUser.count({ where: { appId, firstShareId: { not: null }, createdAt: range } }),
    ])
    const label = new Date(start.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
    out(`${label}  ${String(newUsers).padStart(8)}  ${String(launches).padStart(10)}  ${String(plays).padStart(10)}  ${String(endings).padStart(14)}  ${String(shareNewUsers).padStart(13)}`)
  }
}

async function cmdList(): Promise<void> {
  const apps = await db.dyApp.findMany({ orderBy: { createdAt: 'asc' } })
  if (!apps.length) {
    out('（无 app）')
    return
  }
  for (const app of apps) {
    out(`${app.appId}  ${app.status}  ${app.name}  work=${app.mpWorkId}  releases=[${releaseIdsOf(app).join(',')}]`)
  }
}

async function cmdExportProgram(): Promise<void> {
  const releaseId = arg(0, 'releaseId')
  const outPath = arg(1, 'out.json')
  const release = await db.storyRelease.findUnique({ where: { id: releaseId } })
  if (!release) fail(`release 不存在：${releaseId}`)
  if (!release.programKey || !release.programHash) fail('release 没有 program 产物')
  // 直接取存储里的原始对象：MySQL JSON 列会重排 key，从 program 列重建无法保证字节一致。
  const { getObjectBuffer } = await import('@/lib/storage')
  const body = await getObjectBuffer(release.programKey)
  const hash = createHash('sha256').update(body).digest('hex')
  if (hash !== release.programHash) fail('programHash 校验失败：存储对象与 release 记录不一致')
  writeFileSync(outPath, body)
  out(`已导出 ${outPath}（${body.length} bytes，sha256 ${hash}）`)
}

function usage(): never {
  process.stderr.write(`用法：npx tsx scripts/dy-app.ts <cmd> [...]
  add <appId> <mpWorkSlug> <name>       创建 app（active，空白名单）
  set-secret <appId>                    从 stdin 读入 secret（不回显），加密写入
  allow <appId> <releaseId>             加入白名单（最多 10，校验归属与产物）
  revoke <appId> <releaseId>            移出白名单
  offline <appId>                       下线并清缓存
  online <appId>                        上线并清缓存
  stats <appId> [days=7]                按天（北京时间）输出核心指标
  list                                  列出所有 app（不含 secret）
  export-program <releaseId> <out.json> 导出 program envelope（校验 hash）
`)
  process.exit(1)
}

async function main(): Promise<void> {
  const cmd = process.argv[2]?.trim()
  if (!cmd) usage()
  const [{ prisma }, { redis }] = await Promise.all([import('@/lib/prisma'), import('@/lib/redis')])
  db = prisma
  try {
    switch (cmd) {
      case 'add': return await cmdAdd()
      case 'set-secret': return await cmdSetSecret()
      case 'allow': return await cmdAllow()
      case 'revoke': return await cmdRevoke()
      case 'offline': return await cmdStatus('offline')
      case 'online': return await cmdStatus('active')
      case 'stats': return await cmdStats()
      case 'list': return await cmdList()
      case 'export-program': return await cmdExportProgram()
      default: usage()
    }
  } finally {
    await db.$disconnect().catch(() => undefined)
    redis.disconnect()
  }
}

main().then(
  () => process.exit(0),
  (error) => fail(error instanceof Error ? error.message : String(error)),
)