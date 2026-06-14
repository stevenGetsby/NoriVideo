import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildHomeWorkspaceLaunchTarget,
  createHomeProjectLaunch,
} from '@/lib/home/create-project-launch'

function buildJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createHomeProjectLaunch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates project, saves config, and returns a workspace mode-selection target', async () => {
    const apiFetch = vi
      .fn<(
        input: string,
        init?: RequestInit,
      ) => Promise<Response>>()
      .mockResolvedValueOnce(buildJsonResponse({
        project: { id: 'project-1' },
      }, 201))
      .mockResolvedValueOnce(buildJsonResponse({ success: true }, 200))

    const result = await createHomeProjectLaunch({
      apiFetch,
      projectName: '开场白',
      storyText: '第一章内容',
      videoRatio: '9:16',
      artStyle: 'american-comic',
      episodeName: '第 1 集',
    })

    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '开场白',
        initialNovelText: '第一章内容',
        initialEpisodeName: '第 1 集',
      }),
    })
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/novel-promotion/project-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoRatio: '9:16',
        artStyle: 'american-comic',
      }),
    })
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      projectId: 'project-1',
      target: {
        pathname: '/workspace/project-1',
        query: {
          fromHome: '1',
        },
      },
    })
  })

  it('fails explicitly when project config cannot be saved', async () => {
    const apiFetch = vi
      .fn<(
        input: string,
        init?: RequestInit,
      ) => Promise<Response>>()
      .mockResolvedValueOnce(buildJsonResponse({
        project: { id: 'project-1' },
      }, 201))
      .mockResolvedValueOnce(buildJsonResponse({ error: { message: 'bad config' } }, 400))

    await expect(createHomeProjectLaunch({
      apiFetch,
      projectName: '开场白',
      storyText: '第一章内容',
      videoRatio: '9:16',
      artStyle: 'american-comic',
      episodeName: '第 1 集',
    })).rejects.toThrow('bad config')
  })
})

describe('buildHomeWorkspaceLaunchTarget', () => {
  it('points workspace launch to the creation mode selection', () => {
    expect(buildHomeWorkspaceLaunchTarget('project-9')).toEqual({
      pathname: '/workspace/project-9',
      query: {
        fromHome: '1',
      },
    })
  })
})
