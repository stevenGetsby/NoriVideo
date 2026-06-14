import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('rebuild impact route source', () => {
  it('uses a server-side impact endpoint instead of client-side storyboard counting', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/novel-promotion/[projectId]/rebuild-impact/route.ts'),
      'utf8',
    )
    const mutationSource = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/query/mutations/useProjectConfigMutations.ts'),
      'utf8',
    )

    expect(routeSource).toContain('readEpisodeRebuildImpact')
    expect(routeSource).toContain('requireProjectAuthLight(projectId)')
    expect(mutationSource).toContain('/rebuild-impact?episodeId=')
    expect(mutationSource).toContain('data.counts?.storyboardCount')
    expect(mutationSource).not.toContain('data?.storyboards')
    expect(mutationSource).not.toContain('storyboards.reduce')
  })
})
