import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('export queue route source', () => {
  it('uses authenticated scoped queue records and submits delivery through the task system', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/novel-promotion/[projectId]/export-queue/route.ts'),
      'utf8',
    )

    expect(source).toContain('requireProjectAuthLight(projectId)')
    expect(source).toContain('resolveExportScope')
    expect(source).toContain('resolveExportReadiness')
    expect(source).toContain('upsertExportQueueRecord')
    expect(source).toContain('TASK_TYPE.EXPORT_DELIVERY')
    expect(source).toContain('await submitTask({')
    expect(source).toContain('updateExportQueueTask')
    expect(source).toContain('dedupeKey: `export-delivery:')
  })
})
