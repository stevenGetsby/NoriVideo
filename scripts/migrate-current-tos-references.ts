import TOS from '@volcengine/tos-sdk'
import { prisma } from '../src/lib/prisma'

type TextColumn = { tableName: string; columnName: string }

const SOURCE_BUCKET = process.env.TOS_MIGRATION_SOURCE_BUCKET || 'zizidonghua-huoshan'
const TARGET_BUCKET = process.env.TOS_MIGRATION_TARGET_BUCKET || 'nori-test'
const STORAGE_KEY_PATTERN = /(?:images|video|voice)\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+/g

function identifier(value: string) {
  return `\`${value.replace(/`/g, '')}\``
}

async function referencedStorageKeys() {
  const columns = await prisma.$queryRawUnsafe<TextColumn[]>(
    "SELECT table_name AS tableName,column_name AS columnName FROM information_schema.columns WHERE table_schema=DATABASE() AND data_type IN ('varchar','text','tinytext','mediumtext','longtext','json') AND column_name REGEXP '(url|key|image|audio|video|result|metadata|params|content|payload|json|data|reference)'",
  )
  const keys = new Set<string>()
  for (const column of columns) {
    const rows = await prisma.$queryRawUnsafe<Array<{ value: unknown }>>(
      `SELECT ${identifier(column.columnName)} AS value FROM ${identifier(column.tableName)} WHERE ${identifier(column.columnName)} IS NOT NULL`,
    )
    for (const row of rows) {
      const value = typeof row.value === 'string' ? row.value : JSON.stringify(row.value)
      for (const match of value.matchAll(STORAGE_KEY_PATTERN)) keys.add(match[0])
    }
  }
  return [...keys]
}

async function streamToBuffer(stream: AsyncIterable<unknown>) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer))
  }
  return Buffer.concat(chunks)
}

async function main() {
  const common = {
    accessKeyId: process.env.TOS_ACCESS_KEY || '',
    accessKeySecret: process.env.TOS_SECRET_KEY || '',
    region: process.env.TOS_REGION || 'cn-beijing',
    endpoint: (process.env.TOS_ENDPOINT || 'tos-cn-beijing.volces.com').replace(/^https?:\/\//, ''),
    secure: true,
  }
  const source = new TOS({ ...common, bucket: SOURCE_BUCKET })
  const target = new TOS({ ...common, bucket: TARGET_BUCKET })
  const keys = await referencedStorageKeys()
  let cursor = 0
  let copied = 0
  let skipped = 0
  const failed: Array<{ key: string; error: string }> = []

  const worker = async () => {
    while (true) {
      const index = cursor++
      if (index >= keys.length) return
      const key = keys[index]
      try {
        const sourceHead = await source.headObject({ key })
        const sourceSize = Number(sourceHead.data['content-length'] || 0)
        try {
          const targetHead = await target.headObject({ key })
          if (Number(targetHead.data['content-length'] || -1) === sourceSize) {
            skipped += 1
            continue
          }
        } catch {
          // Missing target objects are copied below.
        }
        const object = await source.getObjectV2({ key })
        const body = await streamToBuffer(object.data.content as AsyncIterable<unknown>)
        await target.putObject({
          key,
          body,
          contentType: object.data['content-type'] || undefined,
        })
        copied += 1
        if (copied % 40 === 0) console.log(`copied ${copied}/${keys.length}`)
      } catch (error) {
        failed.push({ key, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, worker))
  let missing = 0
  let mismatch = 0
  for (const key of keys) {
    try {
      const sourceHead = await source.headObject({ key })
      const targetHead = await target.headObject({ key })
      if (Number(sourceHead.data['content-length']) !== Number(targetHead.data['content-length'])) mismatch += 1
    } catch {
      missing += 1
    }
  }
  console.log(JSON.stringify({
    sourceBucket: SOURCE_BUCKET,
    targetBucket: TARGET_BUCKET,
    referencedKeys: keys.length,
    copied,
    skipped,
    failedCount: failed.length,
    missingCount: missing,
    mismatchCount: mismatch,
    failed: failed.slice(0, 8),
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
