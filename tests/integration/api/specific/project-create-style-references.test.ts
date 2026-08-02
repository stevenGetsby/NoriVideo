import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1', role: 'admin', permissions: ['projectCreate'] } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn(() => 'images/project-style-user-1-test.mp4'),
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
  deleteObject: vi.fn(async () => undefined),
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: {
    findMany: vi.fn(async (): Promise<Array<{ id: string; role: string; status: string }>> => []),
  },
  userPreference: {
    findUnique: vi.fn(async () => null),
  },
  project: {
    create: vi.fn(async () => ({
      id: 'project-1',
      name: 'Style Project',
      description: null,
      userId: 'user-1',
    })),
  },
  work: {
    findFirst: vi.fn(async () => ({ id: 'work-1' })),
  },
  mediaObject: {
    create: vi.fn(async () => ({ id: 'media-1' })),
  },
  projectMember: {
    create: vi.fn(async () => ({ id: 'project-member-1' })),
  },
  novelPromotionProject: {
    create: vi.fn(async () => ({ id: 'np-1', projectId: 'project-1' })),
    update: vi.fn(async () => ({ id: 'np-1' })),
  },
  novelPromotionEpisode: {
    create: vi.fn(async () => ({ id: 'episode-1' })),
  },
  workflowAssignment: {
    create: vi.fn(async () => ({ uuid: 'assignment-1' })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => storageMock)

function atom(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.length + 8, 0)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, payload])
}

function buildIsoVideo(durationSeconds: number): Buffer {
  const ftyp = atom('ftyp', Buffer.from('isom\x00\x00\x02\x00isommp41', 'binary'))
  const mvhdPayload = Buffer.alloc(20)
  mvhdPayload.writeUInt8(0, 0)
  mvhdPayload.writeUInt32BE(1000, 12)
  mvhdPayload.writeUInt32BE(durationSeconds * 1000, 16)
  return Buffer.concat([ftyp, atom('moov', atom('mvhd', mvhdPayload))])
}

function buildProjectRequest(durationSeconds: number, fileCount = 1): NextRequest {
  const form = new FormData()
  form.set('name', 'Style Project')
  form.set('workId', 'work-1')
  for (let index = 0; index < fileCount; index += 1) {
    const video = buildIsoVideo(durationSeconds)
    const fileBytes = new Uint8Array(video.byteLength)
    fileBytes.set(video)
    form.append('styleReferenceFiles', new File(
      [fileBytes],
      `reference-${index + 1}.mp4`,
      { type: 'video/mp4' },
    ))
  }
  return new NextRequest('http://localhost:3000/api/projects', {
    method: 'POST',
    body: form,
  })
}

describe('api specific - project create style references', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.work.findFirst.mockResolvedValue({ id: 'work-1' })
    prismaMock.novelPromotionProject.create.mockResolvedValue({ id: 'np-1', projectId: 'project-1' })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
  })

  it('stores the file through unified storage and persists a structured media reference atomically', async () => {
    const mod = await import('@/app/api/projects/route')
    const response = await mod.POST(buildProjectRequest(12), routeContext)

    expect(response.status).toBe(201)
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      expect.any(Buffer),
      'images/project-style-user-1-test.mp4',
      undefined,
      'video/mp4',
    )
    expect(prismaMock.mediaObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storageKey: 'images/project-style-user-1-test.mp4',
        mimeType: 'video/mp4',
        durationMs: 12_000,
      }),
      select: { id: true },
    })
    expect(prismaMock.novelPromotionProject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        artStyleReferences: [expect.objectContaining({
          mediaId: 'media-1',
          kind: 'video',
          name: 'reference-1.mp4',
          durationMs: 12_000,
          order: 0,
        })],
      }),
    })
    expect(storageMock.deleteObject).not.toHaveBeenCalled()
  })

  it('rejects videos over one minute before uploading or creating a project', async () => {
    const mod = await import('@/app/api/projects/route')
    const response = await mod.POST(buildProjectRequest(61), routeContext)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error.details.styleReferenceIndex).toBe(0)
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    expect(prismaMock.project.create).not.toHaveBeenCalled()
  })

  it('deletes uploaded objects when the project transaction fails', async () => {
    prismaMock.novelPromotionProject.create.mockRejectedValueOnce(new Error('database unavailable'))
    const mod = await import('@/app/api/projects/route')
    const response = await mod.POST(buildProjectRequest(8), routeContext)

    expect(response.status).toBe(502)
    expect(storageMock.deleteObject).toHaveBeenCalledWith('images/project-style-user-1-test.mp4')
  })

  it('cleans earlier files and never enters the transaction when a later upload fails', async () => {
    storageMock.generateUniqueKey
      .mockReturnValueOnce('images/style-first.mp4')
      .mockReturnValueOnce('images/style-second.mp4')
    storageMock.uploadObject
      .mockResolvedValueOnce('images/style-first.mp4')
      .mockRejectedValueOnce(new Error('storage unavailable'))
    const mod = await import('@/app/api/projects/route')
    const response = await mod.POST(buildProjectRequest(8, 2), routeContext)
    const payload = await response.json()

    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(payload.error.details.styleReferenceIndex).toBe(1)
    expect(storageMock.deleteObject).toHaveBeenCalledWith('images/style-first.mp4')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.project.create).not.toHaveBeenCalled()
  })

  it('atomically adds selected role members and starts their project assignments', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: 'writer-1', role: 'writer', status: 'active' },
      { id: 'asset-1', role: 'asset', status: 'active' },
      { id: 'storyboard-1', role: 'storyboard', status: 'active' },
    ])
    const form = new FormData()
    form.set('name', 'Team Project')
    form.set('workId', 'work-1')
    form.set('collaborationMode', 'team')
    form.set('writerAssigneeUserId', 'writer-1')
    form.set('assetAssigneeUserId', 'asset-1')
    form.set('storyboardAssigneeUserId', 'storyboard-1')
    const request = new NextRequest('http://localhost:3000/api/projects', {
      method: 'POST',
      body: form,
    })

    const mod = await import('@/app/api/projects/route')
    const response = await mod.POST(request, routeContext)

    expect(response.status).toBe(201)
    expect(prismaMock.projectMember.create).toHaveBeenCalledTimes(3)
    expect(prismaMock.workflowAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stage: 'script',
        status: 'in_progress',
        assigneeUserId: 'writer-1',
      }),
    })
    expect(prismaMock.workflowAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stage: 'asset',
        status: 'in_progress',
        assigneeUserId: 'asset-1',
      }),
    })
  })
})
