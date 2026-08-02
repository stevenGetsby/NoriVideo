import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryFalStatus } from '@/lib/async-submit'

function response(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('FAL audio queue result parsing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts Stable Audio string URL results', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: 'COMPLETED', response_url: 'https://queue.fal.run/result' }))
      .mockResolvedValueOnce(response({ audio: 'https://cdn.example/stable.wav' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(queryFalStatus(
      'fal-ai/stable-audio-25/text-to-audio',
      'request-stable',
      'fal-key',
    )).resolves.toMatchObject({
      completed: true,
      failed: false,
      resultUrl: 'https://cdn.example/stable.wav',
    })
  })

  it('accepts ElevenLabs object URL results', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: 'COMPLETED', response_url: 'https://queue.fal.run/result' }))
      .mockResolvedValueOnce(response({ audio: { url: 'https://cdn.example/sfx.mp3' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(queryFalStatus(
      'fal-ai/elevenlabs/sound-effects/v2',
      'request-sfx',
      'fal-key',
    )).resolves.toMatchObject({
      completed: true,
      failed: false,
      resultUrl: 'https://cdn.example/sfx.mp3',
    })
  })
})

