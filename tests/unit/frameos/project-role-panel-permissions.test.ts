import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('project role panel permissions', () => {
  it('keeps every project visible while making project creation independently assignable', () => {
    const access = readSource('src/lib/collaboration/access.ts')
    const works = readSource('src/lib/works/service.ts')
    const projectsClient = readSource('src/components/frameos/FosProjectsClient.tsx')

    expect(access).toContain('userId: actor.workspaceOwnerId')
    expect(access).toContain('const canManageProject = isManagementRole(session.user.role)')
    expect(access).toContain("hasAccountPermissions(session.user, ['projectCreate'])")
    expect(works).toContain('const canManage = actor.isManagement')
    expect(works).toContain('canCreateProjects,')
    expect(projectsClient).toContain("session?.user?.role === 'admin'")
    expect(projectsClient).toContain("['projectCreate']")
  })

  it('renders non-owned content panels as readable but non-editable', () => {
    const script = readSource('src/components/frameos/views/FosScriptReview.tsx')
    const assets = readSource('src/components/frameos/views/FosAssetSetting.tsx')
    const storyboard = readSource('src/components/frameos/views/FosStoryboard.tsx')
    const production = readSource('src/components/frameos/views/FosProductionShot.tsx')
    const overview = readSource('src/components/frameos/views/FosWorkbenchOverview.tsx')

    expect(script).toContain("['scriptWrite']")
    expect(assets).toContain("['assetWrite']")
    expect(assets).toContain('readOnly={!canEdit}')
    expect(storyboard).toContain("['storyboardWrite']")
    expect(storyboard).toContain('readOnly={!canEdit}')
    expect(production).toContain("['storyboardWrite']")
    expect(production).toContain('只读 · 分镜师可生成视频')
    expect(overview).toContain('只读 · 资产师可操作')
    expect(overview).toContain('只读 · 分镜师可操作')
  })
})
