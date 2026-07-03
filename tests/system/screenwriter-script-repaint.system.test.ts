import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../integration/api/helpers/call-route'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../helpers/auth'
import { resetSystemState } from '../helpers/db-reset'
import { prisma } from '../helpers/prisma'
import { createFixtureUser } from '../helpers/fixtures'
import { expectLifecycleEvents, listTaskEventTypes } from './helpers/tasks'
import { startSystemWorkers, stopSystemWorkers, type SystemWorkers } from './helpers/workers'

type DetailPayload = {
  task: {
    id: string
    currentStage: string
    stages: Array<{ key: string; status: string }>
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resetScreenwriterState() {
  await prisma.screenwriterArtifact.deleteMany()
  await prisma.screenwriterNameMapping.deleteMany()
  await prisma.screenwriterScriptEpisode.deleteMany()
  await prisma.screenwriterEpisodeProcess.deleteMany()
  await prisma.screenwriterReviewFeedback.deleteMany()
  await prisma.screenwriterSettingsReview.deleteMany()
  await prisma.screenwriterStageState.deleteMany()
  await prisma.screenwriterSourceVideo.deleteMany()
  await prisma.screenwriterTask.deleteMany()
}

async function readScriptRepaintDetail(taskId: string): Promise<DetailPayload['task']> {
  const mod = await import('@/app/api/screenwriter/script-repaint/[taskId]/route')
  const response = await callRoute(
    mod.GET,
    'GET',
    undefined,
    { params: { taskId } },
  )
  expect(response.status).toBe(200)
  const payload = await response.json() as DetailPayload
  return payload.task
}

async function waitForScriptRepaintStage(
  taskId: string,
  expectedStage: string,
  expectedStatus: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 70_000
  const intervalMs = options.intervalMs ?? 300
  const startedAt = Date.now()
  let last: DetailPayload['task'] | null = null

  while (Date.now() - startedAt <= timeoutMs) {
    last = await readScriptRepaintDetail(taskId)
    const stage = last.stages.find((item) => item.key === expectedStage)
    if (last.currentStage === expectedStage && stage?.status === expectedStatus) {
      return last
    }
    if (expectedStage === 'target_script') {
      const repaintStage = last.stages.find((item) => item.key === 'episode_repaint')
      if (last.currentStage === 'episode_repaint' && repaintStage?.status === expectedStatus) {
        return last
      }
    }
    await sleep(intervalMs)
  }

  throw new Error(`SCREENWRITER_STAGE_WAIT_TIMEOUT: expected ${expectedStage}/${expectedStatus}, last=${JSON.stringify(last)}`)
}

describe('system - screenwriter script repaint BullMQ mock workflow', () => {
  let workers: SystemWorkers = {}

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    await resetScreenwriterState()
    await resetSystemState()
    installAuthMocks()
  })

  afterEach(async () => {
    await stopSystemWorkers(workers)
    workers = {}
    resetAuthMockState()
    await resetScreenwriterState()
  })

  it('create -> worker stages -> checkpoints -> target script with task lifecycle events', async () => {
    const user = await createFixtureUser()
    mockAuthenticated(user.id)

    const createMod = await import('@/app/api/screenwriter/script-repaint/route')
    const createResponse = await callRoute(
      createMod.POST,
      'POST',
      {
        title: 'System Script Repaint',
        sourceInputMode: 'paste',
        sourceScriptText: '第一集\n女主进入公司，发现旧项目出现异常。\n第二集\n女主重启项目并说服团队。',
        requirement: '改写为海外职场复仇短剧',
        checkpoints: { A: true, B: true },
      },
      { params: {} },
    )
    expect(createResponse.status).toBe(200)
    const created = await createResponse.json() as { id: string }

    workers = await startSystemWorkers(['text'])

    await waitForScriptRepaintStage(created.id, 'source_settings', 'waiting_check')

    const approveMod = await import('@/app/api/screenwriter/script-repaint/[taskId]/stages/[stage]/approve/route')
    const approveSourceResponse = await callRoute(
      approveMod.POST,
      'POST',
      { feedback: '源设定通过' },
      { params: { taskId: created.id, stage: 'source_settings' } },
    )
    expect(approveSourceResponse.status).toBe(200)

    await waitForScriptRepaintStage(created.id, 'target_settings', 'waiting_check')

    const approveTargetResponse = await callRoute(
      approveMod.POST,
      'POST',
      { feedback: '目标设定通过' },
      { params: { taskId: created.id, stage: 'target_settings' } },
    )
    expect(approveTargetResponse.status).toBe(200)

    await waitForScriptRepaintStage(created.id, 'target_script', 'succeeded')

    const targetScriptMod = await import('@/app/api/screenwriter/script-repaint/[taskId]/target-script/route')
    const targetScriptResponse = await callRoute(
      targetScriptMod.GET,
      'GET',
      undefined,
      { params: { taskId: created.id } },
    )
    expect(targetScriptResponse.status).toBe(200)
    const targetScript = await targetScriptResponse.json() as { episodes: Array<{ content: string }> }
    expect(targetScript.episodes.length).toBeGreaterThan(0)
    expect(targetScript.episodes[0]?.content).toContain('海外职场复仇短剧')

    const workerTasks = await prisma.task.findMany({
      where: {
        type: 'screenwriter_mock',
        targetType: 'screenwriter_task',
        targetId: created.id,
      },
      orderBy: { createdAt: 'asc' },
    })
    expect(workerTasks.map((task) => task.status)).toEqual(['completed', 'completed', 'completed', 'completed'])
    for (const task of workerTasks) {
      expectLifecycleEvents(await listTaskEventTypes(task.id), 'completed')
    }
  }, 90_000)
})
