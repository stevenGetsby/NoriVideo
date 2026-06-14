import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('projects route workflow summary source', () => {
  it('attaches backend workflow summary from stage state and active tasks', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/projects/route.ts'),
      'utf8',
    )
    const workspaceSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/[locale]/workspace/page.tsx'),
      'utf8',
    )

    expect(routeSource).toContain('buildProjectWorkflowSummary')
    expect(routeSource).toContain('prisma.workflowStageState.findMany')
    expect(routeSource).toContain('prisma.task.findMany')
    expect(routeSource).toContain('containsInternalRecordMarker(task.type, task.targetType, task.errorMessage)')
    expect(routeSource).toContain('prisma.usageCost.findMany')
    expect(routeSource).toContain('isInternalUsageCostRecord(item)')
    expect(routeSource).not.toContain('prisma.usageCost.groupBy')
    expect(routeSource).toContain('workflowSummary: buildProjectWorkflowSummary')
    expect(workspaceSource).toContain('workflowSummary?: ProjectWorkflowSummary')
    expect(workspaceSource).toContain('resolveProductionOverviewStage(project)')
    expect(workspaceSource).toContain("t('productionOverview.source')")
  })
})
