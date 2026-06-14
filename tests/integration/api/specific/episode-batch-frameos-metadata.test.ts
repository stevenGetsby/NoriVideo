import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import { EPISODE_FRAMEOS_METADATA_KEY } from '@/lib/novel-promotion/episode-frameos-metadata'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const createCalls = vi.hoisted((): Array<Record<string, unknown>> => [])

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findFirst: vi.fn(async () => ({ id: 'np-project-1' })),
    update: vi.fn(async () => ({ id: 'np-project-1' })),
  },
  novelPromotionEpisode: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    findFirst: vi.fn(async () => null),
    create: vi.fn((args: Record<string, unknown>) => {
      createCalls.push(args)
      return Promise.resolve({ id: `episode-${createCalls.length}`, episodeNumber: createCalls.length, name: 'Episode' })
    }),
  },
  $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => await Promise.all(ops)),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('api specific - episode batch FrameOS metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createCalls.length = 0
  })

  it('stores FrameOS episode metadata in speakerVoices private key', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/batch/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/batch',
      method: 'POST',
      body: {
        clearExisting: true,
        importStatus: 'pending',
        episodes: [
          {
            name: 'Episode One',
            description: 'Opening beat',
            novelText: 'START_MARKER source text END_MARKER',
            frameosMetadata: {
              episode_id: 'episode_001',
              episode_number: 1,
              source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
              reasoning: { diagnosis: 'balanced boundary' },
            },
          },
        ],
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)

    const createArg = createCalls[0] as { data?: { speakerVoices?: string } } | undefined
    expect(createArg).toBeTruthy()
    const saved = JSON.parse(createArg?.data?.speakerVoices || '{}') as Record<string, unknown>
    expect(saved[EPISODE_FRAMEOS_METADATA_KEY]).toEqual({
      episode_id: 'episode_001',
      episode_number: 1,
      source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
      reasoning: { diagnosis: 'balanced boundary' },
    })
  })
})
