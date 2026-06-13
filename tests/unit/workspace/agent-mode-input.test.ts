import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('workspace agent mode input', () => {
  it('auto-starts agent execution when entering agent mode with a prepared prompt from the workspace wizard', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/SmartImportWizard.tsx',
      ),
      'utf8',
    )

    const superInputBlock = source.match(/<SuperInputBox[\s\S]*?\/>/)?.[0] ?? ''

    expect(superInputBlock).toContain('autoExecute')
    expect(superInputBlock).toContain('autoStart={Boolean(wizard.rawContent.trim())}')
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
    expect(source).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]")
    expect(source).toContain('layout="side"')
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
    expect(source).toContain('完成后会直接进入成片总览')
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
    expect(source).toContain('if (!isSuperAgentNavigationLocked(projectId))')
    expect(source).toContain("onStageChange('script')")
    expect(source).toContain("onStageChange('storyboard')")
  })

  it('lets users inspect workspace outputs while Agent automation is still running', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/[locale]/workspace/[projectId]/page.tsx'),
      'utf8',
    )

    expect(source).toContain("from '@/lib/super-agent/navigation-lock'")
    expect(source).toContain('const [agentNavigationLocked, setAgentNavigationLocked] = useState(false)')
    expect(source).toContain("setAgentNavigationLocked(isSuperAgentNavigationLocked(projectId))")
    expect(source).not.toContain("updates.stage !== 'videos' && isSuperAgentNavigationLocked(projectId)")
    expect(source).toContain("const shouldShowImportWizard = importStatus === 'pending' || (agentNavigationLocked && isZeroState)")
    expect(source).toContain("if (!agentNavigationLocked) return")
    expect(source).toContain('queryKeys.storyboards.all(selectedEpisodeId)')
    expect(source).toContain("const shouldAutoCreateEpisode = isZeroState && importStatus !== 'pending' && !agentNavigationLocked")
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

  it('enters Agent input mode without calling the workspace episode-create handler', () => {
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

    expect(wizardSource).toContain('enableAgentCreate')
    expect(wizardSource).toContain("wizard.setStage('agent')")
    expect(pageSource).toContain('enableAgentCreate')
    expect(pageSource).not.toContain('handleAgentCreateFromWizard')
    expect(pageSource).not.toContain('Agent 创建第一集失败')
  })
})
