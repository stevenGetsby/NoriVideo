import { ensureStorageReady } from '@/lib/storage/bootstrap'
import { requireEnv } from '@/lib/storage/utils'
import { prisma } from '@/lib/prisma'

async function ensureStoryboardTextColumns() {
  // Some existing installations were created before these columns became
  // LONGTEXT. Keeping this idempotent guard at startup prevents an old schema
  // from breaking a newly built worker before the formal migration is applied.
  const columns = await prisma.$queryRaw<Array<{ columnName: string; dataType: string }>>`
    SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'novel_promotion_clips'
      AND COLUMN_NAME IN ('content', 'screenplay')
  `
  if (columns.length === 0 || columns.every((column) => column.dataType.toLowerCase() === 'longtext')) return

  await prisma.$executeRawUnsafe(`
    ALTER TABLE novel_promotion_clips
      MODIFY content LONGTEXT NOT NULL,
      MODIFY screenplay LONGTEXT NULL
  `)
}

async function main() {
  await ensureStoryboardTextColumns()
  const result = await ensureStorageReady()

  if (result === 'skipped') {
    return
  }

  const bucket = requireEnv('MINIO_BUCKET')
  if (result === 'created') {
    console.log(`[storage:init] created MinIO bucket "${bucket}"`)
    return
  }

  console.log(`[storage:init] verified MinIO bucket "${bucket}"`)
}

void main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (error: unknown) => {
    console.error('[storage:init] failed to prepare database/storage')
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
