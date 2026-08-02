import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import { PANEL_SEEDANCE_REFERENCE_ASSETS_KEY } from '@/lib/novel-promotion/seedance-reference-assets'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  frameosMaterial: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

import { DELETE, POST } from '@/app/api/novel-promotion/[projectId]/panels/[panelId]/materials/route'

const context = { params: Promise.resolve({ projectId: 'project-1', panelId: 'panel-1' }) }

function panelFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'panel-1',
    actingNotes: JSON.stringify({ _frameosPanelMetadata: { panel_id: 'P01' } }),
    characters: null,
    location: null,
    props: null,
    videoPrompt: null,
    storyboard: {
      episode: {
        episodeNumber: 1,
        novelPromotionProject: {
          characters: [],
          locations: [],
        },
      },
    },
    ...overrides,
  }
}

function readPersistedActingNotes(): Record<string, unknown> {
  const calls = prismaMock.novelPromotionPanel.update.mock.calls as unknown as Array<[{
    data?: { actingNotes?: string | null }
  }]>
  const call = calls.at(-1)?.[0]
  return call?.data?.actingNotes ? JSON.parse(call.data.actingNotes) as Record<string, unknown> : {}
}

describe('FrameOS panel material binding route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(panelFixture())
    prismaMock.frameosMaterial.findFirst.mockResolvedValue({
      id: 'material-1',
      title: '苏晚卿',
      storageKey: 'images/su-wanqing.png',
      resultUrl: '/m/su-wanqing',
    })
  })

  it('adds an account-owned image material without discarding existing panel metadata', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/novel-promotion/project-1/panels/panel-1/materials',
      method: 'POST',
      body: { materialId: 'material-1', kind: 'character' },
    }), context)
    const body = await response.json() as { assets?: Array<Record<string, unknown>> }

    expect(response.status).toBe(200)
    expect(body.assets).toEqual([expect.objectContaining({
      materialId: 'material-1',
      kind: 'character',
      name: '苏晚卿',
      imageUrl: 'images/su-wanqing.png',
    })])
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'material-1',
        userId: 'user-1',
        type: 'image',
        status: 'ready',
        deletedAt: null,
        projectId: { in: ['project-1', 'global', 'global-asset-hub'] },
      },
    })
    const persisted = readPersistedActingNotes()
    expect(persisted._frameosPanelMetadata).toEqual({ panel_id: 'P01' })
    expect(persisted[PANEL_SEEDANCE_REFERENCE_ASSETS_KEY]).toEqual([
      expect.objectContaining({ materialId: 'material-1', name: '苏晚卿' }),
    ])
  })

  it('enforces the nine-reference limit', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(panelFixture({
      actingNotes: JSON.stringify({
        [PANEL_SEEDANCE_REFERENCE_ASSETS_KEY]: Array.from({ length: 9 }, (_, index) => ({
          materialId: `existing-${index}`,
          kind: 'prop',
          name: `道具${index}`,
          imageUrl: `images/prop-${index}.png`,
          role: 'reference_image',
        })),
      }),
    }))

    const response = await POST(buildMockRequest({
      path: '/api/novel-promotion/project-1/panels/panel-1/materials',
      method: 'POST',
      body: { materialId: 'material-1', kind: 'character' },
    }), context)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toContain('最多添加 9 张')
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('removes a material binding while retaining unrelated acting notes', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(panelFixture({
      actingNotes: JSON.stringify({
        directorNote: 'keep this',
        [PANEL_SEEDANCE_REFERENCE_ASSETS_KEY]: [{
          materialId: 'material-1',
          kind: 'character',
          name: '苏晚卿',
          imageUrl: 'images/su-wanqing.png',
          role: 'reference_image',
        }],
      }),
    }))

    const response = await DELETE(buildMockRequest({
      path: '/api/novel-promotion/project-1/panels/panel-1/materials',
      method: 'DELETE',
      query: { materialId: 'material-1' },
    }), context)

    expect(response.status).toBe(200)
    expect(readPersistedActingNotes()).toEqual({ directorNote: 'keep this' })
  })
})
