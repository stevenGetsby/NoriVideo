import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  requireProjectAuth: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  videoEditorProject: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  novelPromotionPanel: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  novelPromotionStoryboard: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionClip: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionShot: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionCharacter: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionLocation: {
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  characterAppearance: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  locationImage: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const uploadObjectMock = vi.hoisted(() => vi.fn())
const submitTaskMock = vi.hoisted(() => vi.fn())
const sharpMock = vi.hoisted(() => vi.fn())
const initializeFontsMock = vi.hoisted(() => vi.fn())
const createLabelSVGMock = vi.hoisted(() => vi.fn())

vi.mock('sharp', () => ({
  default: sharpMock,
}))
vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (value) => value),
}))
vi.mock('@/lib/media/service', () => ({
  resolveMediaRef: vi.fn(async () => null),
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
  resolveStorageKeyFromMediaValue: vi.fn(async (value: unknown) => (
    typeof value === 'string' ? value.replace(/^https:\/\/signed\.example\//, '') : null
  )),
}))
vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(),
  downloadAndUploadImage: vi.fn(async () => 'selected-key.png'),
  generateUniqueKey: vi.fn(() => 'generated-key.jpg'),
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
  toFetchableUrl: vi.fn((url: string) => url),
  uploadObject: uploadObjectMock,
}))
vi.mock('@/lib/fonts', () => ({
  initializeFonts: initializeFontsMock,
  createLabelSVG: createLabelSVGMock,
}))
vi.mock('@/lib/novel-promotion/panel-ai-data-sync', () => ({
  serializeStructuredJsonField: vi.fn((value: unknown) => {
    if (value === null || value === undefined) return null
    return typeof value === 'string' ? value : JSON.stringify(value)
  }),
}))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}))

function createMockImageProcessor() {
  const processor = {
    metadata: vi.fn(async () => ({ width: 100, height: 100 })),
    extend: vi.fn(() => processor),
    composite: vi.fn(() => processor),
    jpeg: vi.fn(() => processor),
    toBuffer: vi.fn(async () => Buffer.from('processed')),
  }
  return processor
}

describe('novel-promotion scoped entity routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'novel-project-1',
      lastEpisodeId: null,
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-1',
      clips: [],
    })
    prismaMock.videoEditorProject.findFirst.mockResolvedValue({
      id: 'editor-1',
      episodeId: 'episode-1',
      projectData: JSON.stringify({ tracks: [] }),
      renderStatus: null,
      outputUrl: null,
      updatedAt: new Date('2026-06-13T00:00:00.000Z'),
    })
    prismaMock.videoEditorProject.delete.mockResolvedValue({ id: 'editor-1' })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValue({
      id: 'line-1',
      episodeId: 'episode-1',
    })
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      storyboard: {
        episode: {
          id: 'episode-1',
        },
      },
    })
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([])
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValue({
      id: 'storyboard-1',
      episodeId: 'episode-1',
      clipId: 'clip-1',
      panels: [],
      clip: { id: 'clip-1' },
    })
    prismaMock.novelPromotionClip.findFirst.mockResolvedValue({
      id: 'clip-1',
    })
    prismaMock.novelPromotionShot.findFirst.mockResolvedValue({
      id: 'shot-1',
    })
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue({
      id: 'character-1',
    })
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValue({
      id: 'location-1',
    })
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: 'appearance-1',
      characterId: 'character-1',
      description: 'old',
      descriptions: JSON.stringify(['old']),
      character: {
        id: 'character-1',
        novelPromotionProject: { projectId: 'project-1' },
      },
    })
    prismaMock.characterAppearance.findFirst.mockResolvedValue({
      id: 'appearance-1',
      imageUrls: JSON.stringify(['old.png']),
      selectedIndex: null,
    })
    prismaMock.locationImage.findFirst.mockResolvedValue({
      id: 'location-image-1',
      locationId: 'location-1',
      imageIndex: 0,
    })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    submitTaskMock.mockResolvedValue({ taskId: 'task-1', async: true })
    uploadObjectMock.mockResolvedValue('generated-key.jpg')
    initializeFontsMock.mockResolvedValue(undefined)
    createLabelSVGMock.mockResolvedValue(Buffer.from('<svg />'))
    sharpMock.mockReturnValue(createMockImageProcessor())
  })

  it('PATCH episode refuses an episode id outside the current project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')

    const res = await PATCH(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/episodes/episode-other',
        method: 'PATCH',
        body: { name: 'Renamed' },
      }),
      { params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-other' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'episode-other',
        novelPromotionProjectId: 'novel-project-1',
      },
    }))
    expect(prismaMock.novelPromotionEpisode.update).not.toHaveBeenCalled()
  })

  it('PATCH voice line refuses a line id outside the current project', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')

    const res = await PATCH(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/voice-lines',
        method: 'PATCH',
        body: { lineId: 'line-other', content: 'new line' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'line-other',
        episode: {
          novelPromotionProjectId: 'novel-project-1',
        },
      },
    }))
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
  })

  it('PATCH clip refuses a clip id outside the current project', async () => {
    prismaMock.novelPromotionClip.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/clips/[clipId]/route')

    const res = await PATCH(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/clips/clip-other',
        method: 'PATCH',
        body: { content: 'new content' },
      }),
      { params: Promise.resolve({ projectId: 'project-1', clipId: 'clip-other' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionClip.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'clip-other',
        episode: {
          novelPromotionProjectId: 'novel-project-1',
        },
      },
    }))
    expect(prismaMock.novelPromotionClip.update).not.toHaveBeenCalled()
  })

  it('DELETE panel refuses a panel id outside the current project', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)
    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/panel/route')

    const res = await DELETE(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/panel',
        method: 'DELETE',
        query: { panelId: 'panel-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'panel-other',
        storyboard: {
          episode: {
            novelPromotionProjectId: 'novel-project-1',
          },
        },
      },
    }))
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('DELETE storyboard group refuses a storyboard id outside the current project', async () => {
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValueOnce(null)
    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/storyboard-group/route')

    const res = await DELETE(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/storyboard-group',
        method: 'DELETE',
        query: { storyboardId: 'storyboard-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'storyboard-other',
        episode: {
          novelPromotionProjectId: 'novel-project-1',
        },
      },
    }))
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('PATCH storyboards refuses a storyboard id outside the current project', async () => {
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/storyboards/route')

    const res = await PATCH(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/storyboards',
        method: 'PATCH',
        body: { storyboardId: 'storyboard-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.update).not.toHaveBeenCalled()
  })

  it('GET storyboards refuses an episode id outside the current project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/storyboards/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/storyboards',
        method: 'GET',
        query: { episodeId: 'episode-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.findMany).not.toHaveBeenCalled()
  })

  it('GET editor does not read an editor project by a cross-project episode id', async () => {
    prismaMock.videoEditorProject.findFirst.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/editor/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/editor',
        method: 'GET',
        query: { episodeId: 'episode-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projectData: null })
    expect(prismaMock.videoEditorProject.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        episodeId: 'episode-other',
        episode: {
          novelPromotionProject: { projectId: 'project-1' },
        },
      },
    }))
  })

  it('DELETE editor refuses an editor project outside the current project', async () => {
    prismaMock.videoEditorProject.findFirst.mockResolvedValueOnce(null)
    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/editor/route')

    const res = await DELETE(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/editor',
        method: 'DELETE',
        query: { episodeId: 'episode-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.videoEditorProject.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        episodeId: 'episode-other',
        episode: {
          novelPromotionProject: { projectId: 'project-1' },
        },
      },
      select: { id: true },
    }))
    expect(prismaMock.videoEditorProject.delete).not.toHaveBeenCalled()
  })

  it('POST lip-sync refuses a panel outside the current project before enqueue', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/lip-sync/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/lip-sync',
        method: 'POST',
        body: {
          storyboardId: 'storyboard-other',
          panelIndex: 0,
          voiceLineId: 'line-1',
          lipSyncModel: 'fal::lip-model',
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        storyboardId: 'storyboard-other',
        panelIndex: 0,
        storyboard: {
          episode: {
            novelPromotionProject: {
              projectId: 'project-1',
            },
          },
        },
      },
    }))
    expect(prismaMock.novelPromotionVoiceLine.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'line-1' }),
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST lip-sync refuses a voice line outside the panel episode before enqueue', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/lip-sync/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/lip-sync',
        method: 'POST',
        body: {
          storyboardId: 'storyboard-1',
          panelIndex: 0,
          voiceLineId: 'line-other',
          lipSyncModel: 'fal::lip-model',
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'line-other',
        episodeId: 'episode-1',
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST generate-video refuses a panel outside the current project before enqueue', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/generate-video/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/generate-video',
        method: 'POST',
        body: {
          storyboardId: 'storyboard-other',
          panelIndex: 0,
          videoModel: 'custom::video-model',
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        storyboardId: 'storyboard-other',
        panelIndex: 0,
        storyboard: {
          episode: {
            novelPromotionProject: {
              projectId: 'project-1',
            },
          },
        },
      },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST generate-video batch refuses an episode outside the current project before enqueue', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/generate-video/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/generate-video',
        method: 'POST',
        body: {
          all: true,
          episodeId: 'episode-other',
          videoModel: 'custom::video-model',
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'episode-other',
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
      select: { id: true },
    }))
    expect(prismaMock.novelPromotionPanel.findMany).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST regenerate-panel-image refuses a panel outside the current project before enqueue', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/regenerate-panel-image/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/regenerate-panel-image',
        method: 'POST',
        body: {
          panelId: 'panel-other',
          count: 1,
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'panel-other',
        storyboard: {
          episode: {
            novelPromotionProject: {
              projectId: 'project-1',
            },
          },
        },
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST modify-storyboard-image refuses a panel outside the current project before enqueue', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/modify-storyboard-image/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/modify-storyboard-image',
        method: 'POST',
        body: {
          storyboardId: 'storyboard-other',
          panelIndex: 0,
          modifyPrompt: 'increase contrast',
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        storyboardId: 'storyboard-other',
        panelIndex: 0,
        storyboard: {
          episode: {
            novelPromotionProject: {
              projectId: 'project-1',
            },
          },
        },
      },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST regenerate-single-image refuses a character appearance outside the current project before enqueue', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/regenerate-single-image/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/regenerate-single-image',
        method: 'POST',
        body: {
          type: 'character',
          id: 'character-other',
          appearanceId: 'appearance-other',
          imageIndex: 0,
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'appearance-other',
        characterId: 'character-other',
        character: {
          novelPromotionProject: {
            projectId: 'project-1',
          },
        },
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST regenerate-single-image refuses a location image outside the current project before enqueue', async () => {
    prismaMock.locationImage.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/regenerate-single-image/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/regenerate-single-image',
        method: 'POST',
        body: {
          type: 'location',
          id: 'location-other',
          imageIndex: 0,
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.locationImage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        locationId: 'location-other',
        imageIndex: 0,
        location: {
          novelPromotionProject: {
            projectId: 'project-1',
          },
        },
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST ai-modify-appearance refuses an appearance outside the current project before enqueue', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/ai-modify-appearance/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/ai-modify-appearance',
        method: 'POST',
        body: {
          characterId: 'character-other',
          appearanceId: 'appearance-other',
          currentDescription: 'old',
          modifyInstruction: 'new',
          async: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'appearance-other',
        characterId: 'character-other',
        character: {
          novelPromotionProject: {
            projectId: 'project-1',
          },
        },
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST ai-modify-location refuses a location outside the current project before enqueue', async () => {
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/ai-modify-location/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/ai-modify-location',
        method: 'POST',
        body: {
          locationId: 'location-other',
          currentDescription: 'old',
          modifyInstruction: 'new',
          async: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionLocation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'location-other',
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST ai-modify-prop refuses a variant outside the current prop before enqueue', async () => {
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValueOnce({
      id: 'prop-1',
      name: 'Relic',
    })
    prismaMock.locationImage.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/ai-modify-prop/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/ai-modify-prop',
        method: 'POST',
        body: {
          propId: 'prop-1',
          variantId: 'variant-other',
          currentDescription: 'old',
          modifyInstruction: 'new',
          async: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.locationImage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'variant-other',
        locationId: 'prop-1',
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST ai-modify-shot-prompt refuses a panel outside the current project before enqueue', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/ai-modify-shot-prompt/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/ai-modify-shot-prompt',
        method: 'POST',
        body: {
          panelId: 'panel-other',
          currentPrompt: 'old prompt',
          modifyInstruction: 'new prompt',
          async: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST analyze-shot-variants refuses a panel outside the current project before enqueue', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/analyze-shot-variants/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/analyze-shot-variants',
        method: 'POST',
        body: { panelId: 'panel-other', async: true },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST insert-panel refuses a storyboard outside the current project before enqueue', async () => {
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/insert-panel/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/insert-panel',
        method: 'POST',
        body: {
          storyboardId: 'storyboard-other',
          insertAfterPanelId: 'panel-other',
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'storyboard-other',
        episode: {
          novelPromotionProject: {
            projectId: 'project-1',
          },
        },
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST regenerate-storyboard-text refuses a storyboard outside the current project before enqueue', async () => {
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/regenerate-storyboard-text/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/regenerate-storyboard-text',
        method: 'POST',
        body: {
          storyboardId: 'storyboard-other',
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'storyboard-other',
        episode: {
          novelPromotionProject: {
            projectId: 'project-1',
          },
        },
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST reference-to-character refuses a background appearance outside the current project before enqueue', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/reference-to-character/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/reference-to-character',
        method: 'POST',
        body: {
          referenceImageUrl: 'https://example.com/ref.png',
          isBackgroundJob: true,
          characterId: 'character-other',
          appearanceId: 'appearance-other',
          async: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'appearance-other',
        characterId: 'character-other',
        character: {
          novelPromotionProject: {
            projectId: 'project-1',
          },
        },
      },
      select: { id: true },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST clips refuses an episode outside the current project before enqueue', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/clips/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/clips',
        method: 'POST',
        body: { episodeId: 'episode-other', async: true },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST script-to-storyboard-stream refuses an episode outside the current project before enqueue', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/script-to-storyboard-stream/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/script-to-storyboard-stream',
        method: 'POST',
        body: { episodeId: 'episode-other', async: true },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST screenplay-conversion refuses an episode outside the current project before enqueue', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/screenplay-conversion/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/screenplay-conversion',
        method: 'POST',
        body: { episodeId: 'episode-other', async: true },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST voice-analyze refuses an episode outside the current project before enqueue', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-analyze/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/voice-analyze',
        method: 'POST',
        body: { episodeId: 'episode-other', async: true },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST analyze refuses an episode outside the current project before enqueue', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/analyze/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/analyze',
        method: 'POST',
        body: { episodeId: 'episode-other', async: true },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST character-profile confirm refuses a character outside the current project before enqueue', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/character-profile/confirm/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/character-profile/confirm',
        method: 'POST',
        body: { characterId: 'character-other', async: true },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('POST update-prompt refuses a shot id outside the current project', async () => {
    prismaMock.novelPromotionShot.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/update-prompt/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/update-prompt',
        method: 'POST',
        body: { shotId: 'shot-other', field: 'imagePrompt', value: 'prompt' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionShot.update).not.toHaveBeenCalled()
  })

  it('PATCH character refuses a character id outside the current project', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/character/route')

    const res = await PATCH(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/character',
        method: 'PATCH',
        body: { characterId: 'character-other', name: 'Alice' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
  })

  it('PATCH location refuses a location id outside the current project', async () => {
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/location/route')

    const res = await PATCH(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/location',
        method: 'PATCH',
        body: { locationId: 'location-other', name: 'Market' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionLocation.update).not.toHaveBeenCalled()
  })

  it('PATCH character-voice refuses a character id outside the current project', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/character-voice/route')

    const res = await PATCH(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/character-voice',
        method: 'PATCH',
        body: { characterId: 'character-other', voiceType: 'preset', voiceId: 'voice-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
  })

  it('POST update-appearance refuses an appearance outside the current project', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValueOnce({
      id: 'appearance-other',
      characterId: 'character-other',
      description: 'old',
      descriptions: JSON.stringify(['old']),
      character: {
        id: 'character-other',
        novelPromotionProject: { projectId: 'project-other' },
      },
    })
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/update-appearance/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/update-appearance',
        method: 'POST',
        body: {
          characterId: 'character-other',
          appearanceId: 'appearance-other',
          newDescription: 'new',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.characterAppearance.update).not.toHaveBeenCalled()
  })

  it('POST update-location refuses a location image outside the current project', async () => {
    prismaMock.locationImage.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/update-location/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/update-location',
        method: 'POST',
        body: { locationId: 'location-other', imageIndex: 0, newDescription: 'new' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.locationImage.update).not.toHaveBeenCalled()
  })

  it('POST panel select-candidate refuses a panel outside the current project', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/panel/select-candidate/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/panel/select-candidate',
        method: 'POST',
        body: { panelId: 'panel-other', action: 'cancel' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('GET speaker-voice refuses an episode outside the current project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/speaker-voice',
        method: 'GET',
        query: { episodeId: 'episode-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
  })

  it('POST character confirm-selection refuses an appearance outside the current project', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValueOnce({
      id: 'appearance-other',
      characterId: 'character-other',
      selectedIndex: 0,
      imageUrls: JSON.stringify(['selected.png', 'other.png']),
      descriptions: JSON.stringify(['selected', 'other']),
      description: 'selected',
      character: {
        name: 'Alice',
        novelPromotionProject: { projectId: 'project-other' },
      },
    })
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/character/confirm-selection/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/character/confirm-selection',
        method: 'POST',
        body: { characterId: 'character-other', appearanceId: 'appearance-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.characterAppearance.update).not.toHaveBeenCalled()
  })

  it('POST location confirm-selection refuses a location outside the current project', async () => {
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/location/confirm-selection/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/location/confirm-selection',
        method: 'POST',
        body: { locationId: 'location-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('POST upload-asset-image refuses a character appearance outside the current project before upload', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/upload-asset-image/route')
    const formData = new FormData()
    formData.set('file', new File([new Uint8Array([1, 2, 3])], 'avatar.jpg', { type: 'image/jpeg' }))
    formData.set('type', 'character')
    formData.set('id', 'character-other')
    formData.set('appearanceId', 'appearance-other')
    formData.set('labelText', 'Alice')

    const res = await POST(
      new NextRequest('http://localhost/api/novel-promotion/project-1/upload-asset-image', {
        method: 'POST',
        body: formData,
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(uploadObjectMock).not.toHaveBeenCalled()
    expect(prismaMock.characterAppearance.update).not.toHaveBeenCalled()
  })

  it('POST video-urls refuses an episode outside the current project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/video-urls/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/video-urls',
        method: 'POST',
        body: { episodeId: 'episode-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
  })

  it('POST regenerate-group refuses a character appearance outside the current project', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/regenerate-group/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/regenerate-group',
        method: 'POST',
        body: {
          type: 'character',
          id: 'character-other',
          appearanceId: 'appearance-other',
          count: 1,
          locale: 'zh',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
  })
})
