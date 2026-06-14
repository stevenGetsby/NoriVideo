import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('workspace agent mode input', () => {
  it('does not expose agent auto-start from the workspace import wizard', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/SmartImportWizard.tsx',
      ),
      'utf8',
    )

    const superInputBlock = source.match(/<SuperInputBox[\s\S]*?\/>/)?.[0] ?? ''

    expect(superInputBlock).toBe('')
    expect(source).not.toContain('autoExecute')
    expect(source).not.toContain('autoStart={Boolean(wizard.rawContent.trim())}')
    expect(source).toContain('<StepSource')
  })

  it('does not expose the old Agent plan parameter confirmation panel', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/super-agent/SuperInputBox.tsx'),
      'utf8',
    )

    expect(source).not.toContain("from './SuperPlanEditor'")
    expect(source).not.toContain("status === 'confirming'")
    expect(source).not.toContain('<SuperPlanEditor')
  })

  it('shows Agent progress immediately during planning as well as execution', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/super-agent/SuperInputBox.tsx'),
      'utf8',
    )

    expect(source).toContain("status === 'planning' || status === 'executing'")
    expect(source).toContain("phase={status}")
    expect(source).toContain("layout === 'side'")
    expect(source).toContain("layout?: 'full' | 'side' | 'modal'")
    expect(source).toContain('Agent 正在规划创作流程')
    expect(source).toContain('规划完成后会自动进入执行')
  })

  it('normalizes completed Agent navigation to the final review stage', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/super-agent/SuperInputBox.tsx'),
      'utf8',
    )

    expect(source).toContain("from '@/lib/super-agent/workspace-url'")
    expect(source).toContain("from '@/lib/super-agent/navigation-lock'")
    expect(source).toContain('setSuperAgentNavigationLock(targetProjectId)')
    expect(source).toContain('clearSuperAgentNavigationLock(targetProjectId)')
    expect(source).toContain('normalizeAgentResultWorkspaceUrl(data.result)')
    expect(source).toContain('normalizeAgentWorkspaceVideoUrl(output.workspaceUrl, output.episodeId)')
    expect(source).toContain('全部完成后会直接打开成片总览')
    expect(source).toContain('Nori 会先锁定资产，再生成视频提示词，并用资产参考图直出单镜视频')
  })

  it('keeps the workspace stage fixed while Agent automation is still running', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceExecution.ts',
      ),
      'utf8',
    )

    expect(source).toContain("from '@/lib/super-agent/navigation-lock'")
    expect(source).toContain('/api/projects/${encodeURIComponent(projectId)}/navigation-state')
    expect(source).toContain('navigationLocked?: boolean')
    expect(source).toContain('serverAgentNavigationLocked || isSuperAgentNavigationLocked(projectId)')
    expect(source).toContain('if (!isAgentNavigationLocked())')
    expect(source).toContain("onStageChange('script')")
    expect(source).toContain("onStageChange('storyboard')")
  })

  it('keeps Agent automation as an internal backend-derived navigation state', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/projects/[projectId]/navigation-state/route.ts'),
      'utf8',
    )
    const stateSource = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/super-agent/navigation-state.ts'),
      'utf8',
    )

    expect(source).toContain("requireProjectAuthLight(projectId)")
    expect(source).toContain('readSuperAgentNavigationState')
    expect(source).toContain('navigationLocked: navigationState.locked')
    expect(source).not.toContain('agentNavigation')
    expect(stateSource).toContain("workflowType: SUPER_AGENT_WORKFLOW_TYPE")
    expect(stateSource).toContain("targetType: 'project'")
    expect(stateSource).toContain('recoverableOnly: true')
  })

  it('does not auto-create a zero-state episode while internal Agent automation is active', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/[locale]/workspace/[projectId]/page.tsx'),
      'utf8',
    )

    expect(source).toContain('/api/projects/${projectId}/navigation-state')
    expect(source).toContain('navigationLocked?: boolean')
    expect(source).toContain('setAgentNavigationWasLocked(true)')
    expect(source).toContain("const shouldShowImportWizard = importStatus === 'pending' || (isZeroState && agentNavigationWasLocked)")
    expect(source).toContain('&& !serverAgentNavigationLocked')
    expect(source).toContain('&& !agentNavigationWasLocked')
    expect(source).not.toContain("from '@/lib/super-agent/navigation-lock'")
  })

  it('uses bounded weighted Agent progress instead of max percent jumps', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/super-agent/SuperInputBox.tsx'),
      'utf8',
    )

    expect(source).toContain('weightedLiveProgress')
    expect(source).toContain("phase === 'planning'")
    expect(source).toContain('Math.min(24')
    expect(source).not.toContain('liveStages.reduce((max, stage)')
  })

  it('keeps storyboard production and final review as separate workspace nodes', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/WorkspaceStageContent.tsx',
      ),
      'utf8',
    )

    expect(source).toContain('<VideoStageRoute viewMode="storyboard" />')
    expect(source).toContain('<VideoStageRoute viewMode="final" />')
    expect(source).not.toContain('<StoryboardStage />')
  })

  it('keeps Agent input mode out of the workspace import wizard', () => {
    const wizardSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/SmartImportWizard.tsx',
      ),
      'utf8',
    )
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/[locale]/workspace/[projectId]/page.tsx'),
      'utf8',
    )

    expect(wizardSource).not.toContain('enableAgentCreate')
    expect(wizardSource).not.toContain("wizard.setStage('agent')")
    expect(pageSource).not.toContain('enableAgentCreate')
    expect(pageSource).not.toContain('handleAgentCreateFromWizard')
    expect(pageSource).not.toContain('Agent 创建第一集失败')
  })
})
