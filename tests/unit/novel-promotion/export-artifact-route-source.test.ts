import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('export artifact route source', () => {
  it('gates artifact downloads through project auth and server-side record lookup', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/novel-promotion/[projectId]/export-artifact/route.ts'),
      'utf8',
    )
    const serviceSource = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/novel-promotion/export-artifact.ts'),
      'utf8',
    )

    expect(routeSource).toContain('requireProjectAuthLight(projectId)')
    expect(routeSource).toContain('findExportArtifactRecord')
    expect(routeSource).toContain('resolveExportArtifactDownloadUrl')
    expect(routeSource).toContain("searchParams.get('redirect') === '1'")
    expect(serviceSource).toContain('prisma.exportQueueRecord.findFirst')
    expect(serviceSource).toContain('prisma.exportHistoryRecord.findFirst')
    expect(serviceSource).toContain('resolveExportScope')
    expect(serviceSource).toContain('userId: params.userId')
    expect(serviceSource).toContain('projectId: params.projectId')
    expect(serviceSource).toContain('outputStorageKey')
  })
})
