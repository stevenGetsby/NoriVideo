import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const submitTaskMock = vi.hoisted(() =>
  vi.fn<typeof import('@/lib/task/submitter').submitTask>(async () => ({
    success: true,
    async: true,
    taskId: 'task-episode-split-1',
    runId: null,
    status: 'queued',
    deduped: false,
  })),
)

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
  }
})

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))

describe('episode split route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
  })

  async function invokeRoute(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/split/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/split',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body,
    })
    return POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
  }

  it('returns 401 when unauthenticated', async () => {
    authState.authenticated = false

    const res = await invokeRoute({ content: '第一集\n这里是测试正文。'.repeat(10) })

    expect(res.status).toBe(401)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('submits a rule-based episode split task without llm observe routing', async () => {
    const content = '第一集\n这里是测试正文，包含足够内容用于触发任务提交。\n第二集\n这里是第二集正文。'.repeat(5)

    const res = await invokeRoute({ content })

    expect(res.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      type: TASK_TYPE.EPISODE_SPLIT_LLM,
      targetType: 'NovelPromotionProject',
      targetId: 'project-1',
      payload: expect.objectContaining({
        content,
        flowId: 'single:episode_split_rule',
        flowStageTitle: '规则分集',
      }),
      dedupeKey: `episode_split_rule:project-1:${content.length}`,
    }))

    const json = await res.json() as Record<string, unknown>
    expect(json.taskId).toBe('task-episode-split-1')
  })
})
