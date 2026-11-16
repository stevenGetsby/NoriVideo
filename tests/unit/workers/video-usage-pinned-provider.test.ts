import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { TaskBillingInfo, TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn(async () => null as { externalId: string | null } | null) },
  project: { findUnique: vi.fn(async () => null) },
}))
const recordServiceUsageMock = vi.hoisted(() => vi.fn(async () => {}))
const resolveRuntimeModelKeyMock = vi.hoisted(() => vi.fn(() => null as string | null))
const settleTaskBillingMock = vi.hoisted(() => vi.fn(async (input: { billingInfo: unknown }) => input.billingInfo))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/platform-services/usage', () => ({ recordServiceUsage: recordServiceUsageMock }))
vi.mock('@/lib/nori-model-catalog', () => ({ resolveRuntimeModelKey: resolveRuntimeModelKeyMock }))
vi.mock('@/lib/api-config', () => ({ getProviderConfig: vi.fn() }))
vi.mock('@/lib/billing', () => ({
  settleTaskBilling: settleTaskBillingMock,
  rollbackTaskBilling: vi.fn(async (input: { billingInfo: unknown }) => input.billingInfo),
}))
vi.mock('@/lib/billing/runtime-usage', () => ({
  withTextUsageCollection: async (fn: () => Promise<unknown>) => ({ result: await fn(), textUsage: null }),
}))
vi.mock('@/lib/task/service', () => ({
  rollbackTaskBillingForTask: vi.fn(async () => ({ billingInfo: null, attempted: false, rolledBack: false })),
  touchTaskHeartbeat: vi.fn(async () => {}),
  tryMarkTaskCompleted: vi.fn(async () => true),
  tryMarkTaskFailed: vi.fn(async () => true),
  tryMarkTaskProcessing: vi.fn(async () => true),
  tryUpdateTaskProgress: vi.fn(async () => true),
  updateTaskBillingInfo: vi.fn(async () => {}),
}))
vi.mock('@/lib/task/publisher', () => ({
  publishTaskEvent: vi.fn(async () => {}),
  publishTaskStreamEvent: vi.fn(async () => {}),
}))
vi.mock('@/lib/run-runtime/publisher', () => ({ publishRunEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/prompt-i18n/user-overrides', () => ({ loadUserPromptOverrides: vi.fn(async () => ({})) }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logWarn: () => {},
}))
vi.mock('@/lib/logging/file-writer', () => ({ onProjectNameAvailable: () => {} }))
vi.mock('@/lib/account/request-context', () => ({
  withTaskQuotaContext: (_userId: string, _payload: unknown, fn: () => Promise<unknown>) => fn(),
}))

import { withTaskLifecycle } from '@/lib/workers/shared'

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64url')

function billingInfo(): TaskBillingInfo {
  return {
    billable: true,
    source: 'task',
    taskType: 'video_panel',
    apiType: 'video',
    model: 'norivideo2.5',
    quantity: 1,
    unit: 'video',
    maxFrozenCost: 10,
    action: 'generate',
    metadata: { duration: 5, containsVideoInput: false },
  }
}

function job(): Job<TaskJobData> {
  return {
    id: 'job-1',
    queueName: 'video',
    attempts: 1,
    opts: {},
    data: {
      taskId: 'task-1',
      type: 'video_panel',
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'panel',
      targetId: 'panel-1',
      userId: 'user-1',
      payload: {},
      billingInfo: billingInfo(),
    },
  } as unknown as Job<TaskJobData>
}

async function runCompletedTask() {
  await withTaskLifecycle(job(), async () => ({ videoUrl: 'https://cdn.example/out.mp4', durationSeconds: 5 }))
}

describe('video usage records the executing provider pinned in externalId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findUnique.mockResolvedValue(null)
    resolveRuntimeModelKeyMock.mockReturnValue(null)
  })

  it('keeps kuaizi attribution when the route switched to tgg mid-flight', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      externalId: `KUAIZI:VIDEO:${b64('kuaizi')}:${b64('doubao-seedance-2-5-260628')}:t1`,
    })
    resolveRuntimeModelKeyMock.mockReturnValue('tgg::current-route-model')

    await runCompletedTask()

    expect(prismaMock.task.findUnique).toHaveBeenCalledWith({ where: { id: 'task-1' }, select: { externalId: true } })
    expect(recordServiceUsageMock).toHaveBeenCalledTimes(1)
    expect(recordServiceUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'kuaizi',
      modelKey: 'kuaizi::doubao-seedance-2-5-260628',
      serviceType: 'video',
      units: 5,
    }))
  })

  it('records tgg when the task executed on tgg but the route points back to kuaizi', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      externalId: `TGG:VIDEO:${b64('tgg')}:${b64('tgg-fixture-video')}:task_9`,
    })
    resolveRuntimeModelKeyMock.mockReturnValue('kuaizi::doubao-seedance-2-5-260628')

    await runCompletedTask()

    expect(recordServiceUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'tgg',
      modelKey: 'tgg::tgg-fixture-video',
      serviceType: 'video',
    }))
  })

  it('falls back to the current route when no externalId was pinned', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null)
    resolveRuntimeModelKeyMock.mockReturnValue('kuaizi::doubao-seedance-2-5-260628')

    await runCompletedTask()

    expect(resolveRuntimeModelKeyMock).toHaveBeenCalledWith('norivideo2.5')
    expect(recordServiceUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'kuaizi',
      modelKey: 'kuaizi::doubao-seedance-2-5-260628',
    }))
  })
})
