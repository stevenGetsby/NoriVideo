import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({ id: 'panel-1' })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

function buildPanel(projectId = 'project-1') {
  return {
    id: 'panel-1',
    storyboard: {
      episode: {
        novelPromotionProject: {
          projectId,
        },
      },
    },
  }
}

describe('api specific - panel link route', () => {
  const routeContext = { params: Promise.resolve({ projectId: 'project-1' }) }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue(buildPanel())
  })

  it('links a panel to the explicit next panel in the same project', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/panel-link/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/panel-link',
      method: 'POST',
      body: {
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        linked: true,
        nextStoryboardId: 'storyboard-2',
        nextPanelIndex: 0,
      },
    })

    const res = await mod.POST(req, routeContext)
    const body = await res.json() as { success?: boolean }

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: {
        storyboardId_panelIndex: {
          storyboardId: 'storyboard-1',
          panelIndex: 0,
        },
      },
      data: {
        linkedToNextPanel: true,
      },
    })
  })

  it('rejects linking when the next panel is not provided', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/panel-link/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/panel-link',
      method: 'POST',
      body: {
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        linked: true,
      },
    })

    const res = await mod.POST(req, routeContext)
    const body = await res.json() as { error?: { code?: string } }

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('INVALID_PARAMS')
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })
})
