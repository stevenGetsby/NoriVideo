import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-fetch', () => ({ apiFetch: apiFetchMock }))

describe('screenwriter API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches screenwriter task summaries from the dedicated API', async () => {
    const { fetchScreenwriterTasks } = await import('@/components/frameos/screenwriter/screenwriterApi')
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      tasks: [{ id: 'sw-task-1', title: 'Demo' }],
      total: 1,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await fetchScreenwriterTasks()

    expect(apiFetchMock).toHaveBeenCalledWith('/api/screenwriter/tasks', { cache: 'no-store' })
    expect(result.tasks).toEqual([{ id: 'sw-task-1', title: 'Demo' }])
  })

  it('creates video repaint tasks through the dedicated API', async () => {
    const { createVideoRepaintTask } = await import('@/components/frameos/screenwriter/screenwriterApi')
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'sw-task-1',
      title: 'Demo',
      nextRoute: '/screenwriter/video-repaint/sw-task-1',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await createVideoRepaintTask({
      title: 'Demo',
      transferForm: 'script',
      uploadMode: 'file',
      sourceAssetName: 'source.mp4',
      requirement: 'modern',
      checkpoints: { A: true, B: true },
    })

    expect(apiFetchMock).toHaveBeenCalledWith('/api/screenwriter/video-repaint', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        title: 'Demo',
        transferForm: 'script',
        uploadMode: 'file',
        sourceAssetName: 'source.mp4',
        requirement: 'modern',
        checkpoints: { A: true, B: true },
      }),
    }))
    expect(result.id).toBe('sw-task-1')
  })

  it('creates script repaint tasks through the dedicated API', async () => {
    const { createScriptRepaintTask } = await import('@/components/frameos/screenwriter/screenwriterApi')
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'sw-task-2',
      title: 'Script Demo',
      nextRoute: '/screenwriter/script-repaint/sw-task-2',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await createScriptRepaintTask({
      title: 'Script Demo',
      sourceInputMode: 'paste',
      sourceScriptText: '第一集\n女主进入公司。',
      requirement: '改为北美现代都市风格',
      checkpoints: { A: true, B: true },
    })

    expect(apiFetchMock).toHaveBeenCalledWith('/api/screenwriter/script-repaint', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        title: 'Script Demo',
        sourceInputMode: 'paste',
        sourceScriptText: '第一集\n女主进入公司。',
        requirement: '改为北美现代都市风格',
        checkpoints: { A: true, B: true },
      }),
    }))
    expect(result).toEqual({
      id: 'sw-task-2',
      title: 'Script Demo',
      nextRoute: '/screenwriter/script-repaint/sw-task-2',
    })
  })

  it('approves checkpoints and fetches target script through screenwriter API', async () => {
    const { approveVideoRepaintStage, fetchTargetScriptEpisodes } = await import('@/components/frameos/screenwriter/screenwriterApi')
    apiFetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ task: { id: 'sw-task-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ episodes: [{ id: 'ep-1' }] }), { status: 200 }))

    await approveVideoRepaintStage('sw-task-1', 'source_settings', 'ok')
    const episodes = await fetchTargetScriptEpisodes('sw-task-1')

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/screenwriter/video-repaint/sw-task-1/stages/source_settings/approve',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/screenwriter/video-repaint/sw-task-1/target-script',
      { cache: 'no-store' },
    )
    expect(episodes).toEqual([{ id: 'ep-1' }])
  })
})
