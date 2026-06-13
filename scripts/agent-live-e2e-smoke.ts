import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import type { AgentExecutionPlan } from '../src/lib/super-agent/types'

dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

type PanelSnapshot = {
  id: string
  panelNumber: number | null
  description: string | null
  videoPrompt: string | null
  duration: number | null
  imageUrl: string | null
  imageMediaId: string | null
  videoUrl: string | null
  videoMediaId: string | null
}

type SmokeReport = {
  ok: boolean
  createdAt: string
  userId?: string
  projectId?: string
  episodeId?: string
  workspaceUrl?: string
  status?: string
  progress: Array<{ stage: string; percent: number; at: string }>
  stageResults?: unknown
  counts?: {
    clips: number
    storyboards: number
    panels: number
    panelsWithImages: number
    panelsWithVideos: number
    characters: number
    locations: number
    props: number
    workflowStages: number
  }
  firstPanel?: {
    id: string
    hasImage: boolean
    hasVideo: boolean
    duration: number | null
    videoPromptPreview: string
    promptHasTimedActionLine: boolean
    promptHasAgentMarker: boolean
    promptHasAssetUsage: boolean
  } | null
  assetConsistency?: {
    hasGlobalAssetBrief: boolean
    hasRegionCritic: boolean
  }
  videoTasks?: {
    total: number
    completed: number
    failed: number
    fallbackCount: number
    errors: string[]
  }
  errors: string[]
}

function ensureRuntimeDir() {
  fs.mkdirSync(path.join(process.cwd(), '.runtime'), { recursive: true })
}

function writeReport(report: SmokeReport) {
  ensureRuntimeDir()
  const reportPath = path.join(process.cwd(), '.runtime', 'agent-live-e2e-report.json')
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return reportPath
}

function countTruthyPanelField(panels: PanelSnapshot[], field: 'imageUrl' | 'imageMediaId' | 'videoUrl' | 'videoMediaId') {
  return panels.filter((panel) => {
    const value = panel[field]
    return typeof value === 'string' && value.trim()
  }).length
}

function buildSmokePrompt(): string {
  return [
    '请用 Agent 自动创作模式生成一支 9:16 产品演示测试短片，现代科技产品质感，不要真人、不要人脸、不要中文字幕、不要背景音乐。',
    '工作流必须先抽取并锁定全局资产，再按剧情片段生成分镜；只生成 1 个剧情片段和 1 个视频分镜。',
    '每个视频分镜必须包含场景、人物站位、镜头语言、按秒拆分的动作/对白和全局负面要求。',
    '全局资产：',
    'Nori Cube：透明玻璃质感的发光立方体，内部有柔和蓝白光线，代表一个创意从输入到视频输出的流程。',
    '场景资产：现代极简工作台，深灰桌面，一台打开的轻薄笔记本，背景是柔和虚化的创作工作室。',
    '剧情：Nori Cube 在工作台上亮起，笔记本屏幕旁出现从 prompt 到 storyboard 再到 video 的抽象流程光带，最后形成一个完整视频缩略画面。不要出现任何真人或人脸。',
  ].join('\n')
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function inferSmokeArtStylePrompt(userInput: string): string {
  if (/(医疗|医院|医生|手术|真人|欧美|英文口型|Ava|Grayson|Nurse|Doctor|hospital|doctor|surgery|medical)/i.test(userInput)) {
    return [
      '9:16 竖屏欧美医疗短剧转绘视频，真实真人短剧质感，现代美国私立医院环境。',
      '角色脸部、服装、发型、体型全程一致，英文口型同步，不要中文字幕，不要背景音乐。',
      '医院场景使用英文导视牌、冷白 LED 顶灯、白色与浅蓝色空间，不要变成亚洲医院。',
    ].join('')
  }
  return '现代科技产品演示质感，玻璃发光立方体，极简工作台，真实摄影光影，不要真人，不要人脸，不要中文字幕，不要背景音乐。'
}

function buildPlan(userInput: string): AgentExecutionPlan {
  const shotCount = readPositiveIntEnv('NORI_AGENT_SMOKE_SHOT_COUNT', 1)
  const panelsPerShot = readPositiveIntEnv('NORI_AGENT_SMOKE_PANELS_PER_SHOT', 1)
  return {
    projectConfig: {
      name: `Agent Live E2E Smoke ${new Date().toISOString().replace(/[:.]/g, '-')}`,
      videoRatio: '9:16',
      artStyle: 'realistic',
      artStylePrompt: inferSmokeArtStylePrompt(userInput),
    },
    episodeConfig: {
      name: 'Agent E2E 第一集',
      novelText: userInput,
    },
    selectedSkill: 'generic',
    skillDescription: '真实 Agent 端到端链路验证',
    executionMode: 'live',
    creativeParameters: {
      durationSeconds: 5,
      targetAudience: 'Nori internal QA',
      tone: '真实、清晰、克制',
      narration: 'off',
      shotCount,
      panelsPerShot,
      mockPrompt: userInput,
    },
    stages: [],
    estimatedDuration: 0,
  }
}

async function readProjectSnapshot(projectId: string, episodeId: string) {
  const { prisma } = await import('../src/lib/prisma')

  const [episode, novelProject, workflowStages, videoTasks] = await Promise.all([
    prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        clips: { orderBy: { start: 'asc' } },
        storyboards: {
          orderBy: { createdAt: 'asc' },
          include: {
            panels: {
              orderBy: { panelIndex: 'asc' },
              select: {
                id: true,
                panelNumber: true,
                description: true,
                videoPrompt: true,
                duration: true,
                imageUrl: true,
                imageMediaId: true,
                videoUrl: true,
                videoMediaId: true,
              },
            },
          },
        },
      },
    }),
    prisma.novelPromotionProject.findUnique({
      where: { projectId },
      include: {
        characters: true,
        locations: true,
      },
    }),
    prisma.graphEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        episodeId,
        type: 'video_panel',
      },
      select: {
        status: true,
        result: true,
        errorMessage: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const panels = (episode?.storyboards || []).flatMap((storyboard) => storyboard.panels as PanelSnapshot[])
  const firstPanel = panels[0] || null
  const globalAssetText = novelProject?.globalAssetText || ''
  const fallbackCount = videoTasks.filter((task) => (
    task.result
    && typeof task.result === 'object'
    && !Array.isArray(task.result)
    && (task.result as Record<string, unknown>).fallbackMode === 'ark_text_only_after_input_image_moderation'
  )).length
  return {
    episode,
    novelProject,
    workflowStages,
    assetConsistency: {
      hasGlobalAssetBrief: globalAssetText.includes('【Agent 资产一致性简报】'),
      hasRegionCritic: globalAssetText.includes('地域/语言 critic'),
    },
    videoTasks: {
      total: videoTasks.length,
      completed: videoTasks.filter((task) => task.status === 'completed').length,
      failed: videoTasks.filter((task) => task.status === 'failed').length,
      fallbackCount,
      errors: videoTasks
        .map((task) => task.errorMessage || '')
        .filter(Boolean)
        .slice(0, 5),
    },
    panels,
    counts: {
      clips: episode?.clips.length || 0,
      storyboards: episode?.storyboards.length || 0,
      panels: panels.length,
      panelsWithImages: Math.max(
        countTruthyPanelField(panels, 'imageUrl'),
        countTruthyPanelField(panels, 'imageMediaId'),
      ),
      panelsWithVideos: Math.max(
        countTruthyPanelField(panels, 'videoUrl'),
        countTruthyPanelField(panels, 'videoMediaId'),
      ),
      characters: novelProject?.characters.length || 0,
      locations: novelProject?.locations.filter((item) => item.assetKind !== 'prop').length || 0,
      props: novelProject?.locations.filter((item) => item.assetKind === 'prop').length || 0,
      workflowStages: workflowStages.length,
    },
    firstPanel: firstPanel
      ? {
        id: firstPanel.id,
        hasImage: Boolean(firstPanel.imageUrl || firstPanel.imageMediaId),
        hasVideo: Boolean(firstPanel.videoUrl || firstPanel.videoMediaId),
        duration: firstPanel.duration,
        videoPromptPreview: (firstPanel.videoPrompt || '').slice(0, 500),
        promptHasTimedActionLine: /本 panel 动作\/台词：\s*\d+\s*-\s*\d+s/.test(firstPanel.videoPrompt || ''),
        promptHasAgentMarker: (firstPanel.videoPrompt || '').includes('【Agent 视频分镜提示词】'),
        promptHasAssetUsage: (firstPanel.videoPrompt || '').includes('本分镜使用资产：'),
      }
      : null,
  }
}

async function main() {
  const userInput = process.env.NORI_AGENT_SMOKE_PROMPT?.trim() || buildSmokePrompt()
  const report: SmokeReport = {
    ok: false,
    createdAt: new Date().toISOString(),
    progress: [],
    errors: [],
  }

  try {
    const [
      { getOrCreateTestModeSession },
      { SuperAgentOrchestrator },
      { createAgentWorkflowStages },
    ] = await Promise.all([
      import('../src/lib/test-mode'),
      import('../src/lib/super-agent/orchestrator'),
      import('../src/lib/super-agent/plan-utils'),
    ])

    const session = await getOrCreateTestModeSession()
    const plan = {
      ...buildPlan(userInput),
      stages: createAgentWorkflowStages(),
    }
    const orchestrator = new SuperAgentOrchestrator()
    report.userId = session.user.id

    const result = await orchestrator.executePlan(
      plan,
      {
        userId: session.user.id,
        locale: 'zh',
        userInput,
        executionMode: 'live',
        parameters: plan.creativeParameters,
      },
      (stage, percent) => {
        const item = { stage, percent, at: new Date().toISOString() }
        report.progress.push(item)
        process.stdout.write(`[agent-live-e2e] ${percent}% ${stage}\n`)
        writeReport(report)
      },
    )

    report.projectId = result.projectId
    report.episodeId = result.episodeId
    report.workspaceUrl = result.workspaceUrl
    report.status = result.status
    report.stageResults = result.stageResults
    report.errors.push(...result.errors)

    const snapshot = await readProjectSnapshot(result.projectId, result.episodeId)
    report.counts = snapshot.counts
    report.assetConsistency = snapshot.assetConsistency
    report.videoTasks = snapshot.videoTasks
    report.firstPanel = snapshot.firstPanel
    report.ok = result.status === 'completed'
      && snapshot.counts.clips > 0
      && snapshot.counts.storyboards > 0
      && snapshot.counts.panels > 0
      && snapshot.assetConsistency.hasGlobalAssetBrief
      && snapshot.assetConsistency.hasRegionCritic
      && snapshot.counts.panelsWithImages === snapshot.counts.panels
      && snapshot.counts.panelsWithVideos === snapshot.counts.panels
      && snapshot.firstPanel?.promptHasTimedActionLine === true
      && snapshot.firstPanel?.promptHasAgentMarker === true
      && snapshot.firstPanel?.promptHasAssetUsage === true
  } catch (error) {
    report.errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  }

  const reportPath = writeReport(report)
  process.stdout.write(`[agent-live-e2e] report=${reportPath}\n`)
  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    status: report.status,
    projectId: report.projectId,
    episodeId: report.episodeId,
    workspaceUrl: report.workspaceUrl,
    counts: report.counts,
    assetConsistency: report.assetConsistency,
    videoTasks: report.videoTasks,
    firstPanel: report.firstPanel,
    errors: report.errors,
  }, null, 2)}\n`)

  try {
    const { prisma } = await import('../src/lib/prisma')
    await prisma.$disconnect()
  } catch {
    // The smoke result has already been written.
  }

  process.exit(report.ok ? 0 : 1)
}

void main()
