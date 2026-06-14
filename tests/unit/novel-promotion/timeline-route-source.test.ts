import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('timeline route source', () => {
  it('supports backend-owned batch edits and reorder with project ownership checks', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/novel-promotion/[projectId]/timeline/route.ts'),
      'utf8',
    )
    const focusSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/WorkbenchFocusPanel.tsx',
      ),
      'utf8',
    )

    expect(routeSource).toContain('export const PATCH = apiHandler')
    expect(routeSource).toContain('normalizeUpdates(body.updates)')
    expect(routeSource).toContain('normalizeReorder(body.reorder)')
    expect(routeSource).toContain('novelPromotionProject: { projectId }')
    expect(routeSource).toContain('return NextResponse.json(buildTimelineSummary')
    expect(focusSource).toContain('`/api/novel-promotion/${projectId}/timeline`')
    expect(focusSource).toContain('setTimelineSummary')
    expect(focusSource).toContain('loadTimelineSummary')
    expect(focusSource).toContain('timelineStats?.missingVideos')
    expect(focusSource).toContain('timelinePanelRows.slice(0, 12)')
    expect(focusSource).toContain('updates: payloads')
    expect(focusSource).toContain('reorder: {')
  })
})
