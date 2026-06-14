import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('export queue route source', () => {
  it('computes readiness on the server instead of trusting client status', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/novel-promotion/[projectId]/export-queue/route.ts'),
      'utf8',
    )
    const stageSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/ExportDeliveryStage.tsx',
      ),
      'utf8',
    )

    expect(routeSource).toContain('resolveExportReadiness')
    expect(routeSource).toContain('normalizeExportReadinessCardId(body.cardId)')
    expect(routeSource).toContain("queueStatus = item.status === 'blocked' ? 'blocked' : 'queued'")
    expect(routeSource).not.toContain('body.status')
    expect(routeSource).not.toContain('body.title')
    expect(routeSource).not.toContain('body.blocker')
    expect(stageSource).toContain('setServerExportQueueItems')
    expect(stageSource).toContain('setQueueLoadError(true)')
    expect(stageSource).toContain('body: JSON.stringify({')
    expect(stageSource).toContain('cardId: item.cardId')
    expect(stageSource).toContain('body: JSON.stringify({ cardId })')
    expect(stageSource).toContain("'voice-package'")
    expect(stageSource).toContain('cards.voicePackage.title')
    expect(routeSource).toContain('normalizeExportReadinessCardId(body.cardId)')
    expect(stageSource).not.toContain('fallbackExportQueueItems')
    expect(stageSource).not.toContain('sourceExportQueueItems')
    expect(stageSource).not.toContain('serverExportQueueItems.length > 0 ? serverExportQueueItems')
    expect(stageSource).not.toContain('title: item.title')
    expect(stageSource).not.toContain('blocker: item.blocker')
    expect(stageSource).not.toContain('download-videos')
    expect(stageSource).not.toContain('download-images')
    expect(stageSource).not.toContain('export-manifest?episodeId=')
    expect(stageSource).not.toContain("apiFetch(`/api/novel-promotion/${projectId}/export-history?episodeId=${episodeId}`, {")
  })
})
