import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compileFrameos3DPrompt,
  submitFrameos3DGeneration,
  waitForFrameos3DGeneration,
  type Frameos3DProviderConfig,
} from '@/lib/model3d/frameos-3d-provider'

const config: Frameos3DProviderConfig = {
  protocol: 'tripo-v2',
  baseUrl: 'https://model.example/v2/openapi',
  apiKey: 'test-token',
  modelVersion: 'v3-test',
  createPath: '/task',
  taskPath: '/task/{taskId}',
  pollIntervalMs: 1,
  timeoutMs: 2_000,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FrameOS 3D provider contract', () => {
  it('compiles topology, texture and pose requirements into a provider-safe prompt', () => {
    const prompt = compileFrameos3DPrompt({
      prompt: 'A young detective with a long coat',
      topology: 'low_poly',
      generateTexture: false,
      pose: 't_pose',
    })

    expect(prompt).toContain('A young detective with a long coat')
    expect(prompt).toContain('low-poly topology')
    expect(prompt).toContain('geometry only')
    expect(prompt).toContain('T-pose')
  })

  it('submits the Tripo async contract without leaking branded-only fields', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { task_id: 'external-1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const submission = await submitFrameos3DGeneration(config, {
      prompt: 'ornate wooden chair',
      topology: 'standard',
      generateTexture: true,
      pose: 'none',
    })

    expect(submission).toEqual({ externalTaskId: 'external-1', result: null })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      type: 'text_to_model',
      model_version: 'v3-test',
      texture: true,
      pbr: true,
    })
    expect(body).not.toHaveProperty('topology')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('polls an existing task and resolves the GLB plus thumbnail URLs', async () => {
    const progress = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { status: 'running', progress: 0.5 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          status: 'success',
          progress: 100,
          output: {
            pbr_model: 'https://cdn.example/model.glb',
            rendered_image: 'https://cdn.example/model.png',
          },
        },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(waitForFrameos3DGeneration(config, 'external-1', progress)).resolves.toEqual({
      modelUrl: 'https://cdn.example/model.glb',
      thumbnailUrl: 'https://cdn.example/model.png',
    })
    expect(progress).toHaveBeenNthCalledWith(1, 50, 'running')
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://model.example/v2/openapi/task/external-1',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})
