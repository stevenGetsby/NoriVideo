import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FrameOS collaboration assignment deep links', () => {
  it('preflights assignment navigation before pushing the workflow route', () => {
    const client = readSource('src/components/frameos/FosAssignmentsClient.tsx')
    const route = readSource('src/app/api/collaboration/assignments/[assignmentId]/navigation/route.ts')
    const gate = readSource('src/lib/collaboration/assignment-navigation.ts')

    const navigationStart = client.indexOf('const navigateToAssignment = useCallback')
    const navigationEnd = client.indexOf('const runAction = useCallback', navigationStart)
    const navigation = client.slice(navigationStart, navigationEnd)
    expect(navigation.indexOf('/navigation?intent=${intent}')).toBeLessThan(navigation.indexOf('router.push({'))
    expect(route).toContain('validateAssignmentNavigation')
    expect(gate).toContain('await requireProjectReader(session, assignment.projectId)')
    expect(gate).toContain('isProjectLevelStage(assignment.stage)')
    expect(gate).toContain("stageKey: 'storyboard'")
    expect(gate).toContain("reviewState: 'confirmed'")
    expect(gate).toContain('requireProjectAssignmentReviewer')
    expect(gate).toContain('hasAccountPermissions')
  })

  it('carries episode_id and return context into storyboard, generation, and editing', () => {
    const page = readSource('src/app/[locale]/workflow/[projectId]/workbench-premium2/[[...segments]]/page.tsx')
    const workflow = readSource('src/components/frameos/FosWorkflowClient.tsx')
    const storyboard = readSource('src/components/frameos/views/FosStoryboard.tsx')
    const productionShot = readSource('src/components/frameos/views/FosProductionShot.tsx')
    const viewModel = readSource('src/components/frameos/assignments-view-model.ts')

    expect(page).toContain('initialEpisodeId={firstQueryValue(query.episode_id)}')
    expect(page).toContain('assignmentReturnTo={assignmentReturnPath(')
    expect(page).toContain('firstQueryValue(query.from_tab)')
    expect(workflow).toContain('<FosStoryboard data={data} initialEpisodeId={initialEpisodeId} />')
    expect(workflow).toContain('<FosAssemblyEditor data={data} initialEpisodeId={initialEpisodeId} />')
    expect(workflow).toContain('<FosProductionShot data={data} initialEpisodeId={initialEpisodeId} />')
    expect(workflow).toContain("backTo={assignmentReturnTo ?? '/works'}")
    expect(workflow).toContain('backTo={assignmentReturnTo ?? parentBackTo}')
    expect(workflow).toContain("backLabel={assignmentReturnTo ? '返回我的任务' : parentBackLabel}")
    expect(storyboard).toContain('episodes.find((episode) => episode.id === initialEpisodeId)')
    expect(productionShot).toContain('data.episodes.find((episode) => episode.id === initialEpisodeId)')
    expect(productionShot).toContain('active="generate"')
    expect(viewModel).toContain('return `${base}/production/shot`')
    expect(viewModel).toContain("from: 'my-assignments'")
    expect(viewModel).toContain('from_tab: fromTab')
  })
})
