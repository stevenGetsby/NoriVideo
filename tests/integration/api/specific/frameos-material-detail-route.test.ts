import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { projectParticipantWhere } from '@/lib/collaboration/access'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => {
  const client = {
    project: {
      findFirst: vi.fn(),
    },
    frameosMaterial: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    novelPromotionCharacter: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    mediaObject: {
      findUnique: vi.fn(),
    },
    canvas: {
      findMany: vi.fn(),
    },
    canvasWorkflowTemplate: {
      findMany: vi.fn(),
    },
  }
  return {
    ...client,
    $transaction: vi.fn(async (operation: (tx: typeof client) => unknown) => await operation(client)),
  }
})
const deleteObjectMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => ({ deleteObject: deleteObjectMock }))
vi.mock('@/lib/api-auth', () => ({
  requireUserPermission: authMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

import { DELETE, PATCH } from '@/app/api/frameos/materials/[materialId]/route'

const context = { params: Promise.resolve({ materialId: 'material-1' }) }
const updatedAt = new Date('2026-07-18T01:00:00.000Z')
const globalMaterial = {
  id: 'material-1',
  userId: 'owner-1',
  projectId: 'global',
  source: 'upload',
  title: '旧名称',
  isFavorited: false,
  storageKey: 'frameos-material-owner-1/upload.png',
  deletedAt: null,
  deletedById: null,
  updatedAt,
}

function request(method: 'PATCH' | 'DELETE', body?: unknown) {
  return buildMockRequest({
    path: '/api/frameos/materials/material-1',
    method,
    body,
  })
}

describe('FrameOS material detail route', () => {
  it('binds a ready same-project voice to an uploaded role card without changing file type', async () => {
    const card = { ...globalMaterial, type: 'image', projectId: 'project-1', metadata: { assetCategory: 'character', prompt: '角色' } }
    prismaMock.frameosMaterial.findFirst.mockReset()
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce(card).mockResolvedValueOnce({ id: 'voice-1' }).mockResolvedValueOnce(card)
    const response = await PATCH(request('PATCH', { voiceMaterialId: 'voice-1' }), context)
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { metadata: { assetCategory: 'character', prompt: '角色', voiceMaterialId: 'voice-1' } } }))
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ type: 'audio', status: 'ready', deletedAt: null, projectId: { in: ['project-1', 'personal', 'global', 'global-asset-hub'] } }) }))
  })

  it('rejects missing/other-project voice ids before modifying the role card', async () => {
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ ...globalMaterial, type: 'image', metadata: { assetCategory: 'character' } }).mockResolvedValueOnce(null)
    expect((await PATCH(request('PATCH', { voiceMaterialId: 'voice-private' }), context)).status).toBe(404)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('does not permit scenes or videos to masquerade as character cards', async () => {
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ ...globalMaterial, type: 'image', metadata: { assetCategory: 'location' } })
    expect((await PATCH(request('PATCH', { voiceMaterialId: 'voice-1' }), context)).status).toBe(400)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('blocks deletion of audio still bound by a role card', async () => {
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ ...globalMaterial, type: 'audio' })
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([{ id: 'role-card', title: '关羽', metadata: { voiceMaterialId: 'material-1' } }])
    expect((await DELETE(request('DELETE'), context)).status).toBe(409)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({
      session: { user: { id: 'owner-1', actorId: 'owner-1', workspaceOwnerId: 'owner-1', role: 'admin' } },
    })
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1' })
    prismaMock.frameosMaterial.findFirst.mockResolvedValue(globalMaterial)
    prismaMock.frameosMaterial.findMany.mockResolvedValue([])
    prismaMock.frameosMaterial.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.frameosMaterial.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.frameosMaterial.count.mockResolvedValue(0)
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue(null)
    prismaMock.novelPromotionCharacter.update.mockResolvedValue({ id: 'character-1' })
    prismaMock.mediaObject.findUnique.mockResolvedValue(null)
    prismaMock.canvas.findMany.mockResolvedValue([])
    prismaMock.canvasWorkflowTemplate.findMany.mockResolvedValue([])
    deleteObjectMock.mockResolvedValue(undefined)
  })

  it('requires assetWrite and updates an account material without a project lookup', async () => {
    const updated = { ...globalMaterial, title: '新名称', isFavorited: true }
    prismaMock.frameosMaterial.findFirst
      .mockResolvedValueOnce(globalMaterial)
      .mockResolvedValueOnce(updated)

    const response = await PATCH(request('PATCH', { title: '  新名称  ', isFavorited: true }), context)

    expect(response.status).toBe(200)
    expect(authMock).toHaveBeenCalledWith(['assetWrite'])
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'material-1',
        userId: 'owner-1',
        projectId: 'global',
        updatedAt,
        deletedAt: null,
      },
      data: { title: '新名称', isFavorited: true },
    })
  })

  it.each([null, [], 'text', { title: '' }, { title: 1 }, { title: ' '.repeat(5) }, { title: '长'.repeat(161) }])(
    'rejects invalid names and request bodies without changes: %j', async (body) => {
      const response = await PATCH(request('PATCH', body), context)
      expect(response.status).toBe(400)
      expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
    },
  )

  it('reclassifies an existing material without discarding its metadata', async () => {
    const current = { ...globalMaterial, metadata: { prompt: '雨夜角色' } }
    const updated = { ...current, metadata: { prompt: '雨夜角色', assetCategory: 'character' } }
    prismaMock.frameosMaterial.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(updated)

    const response = await PATCH(request('PATCH', { assetCategory: 'character' }), context)

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { metadata: { prompt: '雨夜角色', assetCategory: 'character' } },
    }))
  })

  it('rejects unknown material categories before reading the material', async () => {
    const response = await PATCH(request('PATCH', { assetCategory: 'unknown-folder' }), context)

    expect(response.status).toBe(400)
    expect(prismaMock.frameosMaterial.findFirst).not.toHaveBeenCalled()
  })

  it('binds an audio material to a project character and synchronizes the character voice', async () => {
    const audioMaterial = {
      ...globalMaterial,
      projectId: 'project-1',
      type: 'audio',
      resultUrl: '/api/media/voice-1',
      storageKey: 'project-1/voice-1.wav',
      metadata: { assetCategory: 'character' },
    }
    const updated = {
      ...audioMaterial,
      metadata: {
        assetCategory: 'character',
        characterId: 'character-1',
        characterName: '苏晚卿',
      },
    }
    prismaMock.frameosMaterial.findFirst
      .mockResolvedValueOnce(audioMaterial)
      .mockResolvedValueOnce(updated)
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce({ id: 'character-1', name: '苏晚卿' })
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce({ id: 'media-voice-1' })

    const response = await PATCH(request('PATCH', { characterId: 'character-1' }), context)

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        metadata: {
          assetCategory: 'character',
          characterId: 'character-1',
          characterName: '苏晚卿',
        },
      },
    }))
    expect(prismaMock.novelPromotionCharacter.update).toHaveBeenCalledWith({
      where: { id: 'character-1' },
      data: {
        voiceType: 'uploaded',
        voiceId: null,
        customVoiceUrl: '/api/media/voice-1',
        customVoiceMediaId: 'media-voice-1',
      },
    })
  })

  it('checks the shared management workspace before an asset subaccount updates project material', async () => {
    authMock.mockResolvedValueOnce({
      session: {
        user: {
          id: 'owner-1',
          actorId: 'asset-1',
          workspaceOwnerId: 'owner-1',
          role: 'asset',
        },
      },
    })
    const projectMaterial = { ...globalMaterial, projectId: 'project-1' }
    prismaMock.frameosMaterial.findFirst
      .mockResolvedValueOnce(projectMaterial)
      .mockResolvedValueOnce({ ...projectMaterial, isFavorited: true })

    const response = await PATCH(request('PATCH', { isFavorited: true }), context)

    expect(response.status).toBe(200)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'owner-1',
        deletedAt: null,
        ...projectParticipantWhere('asset-1'),
      },
      select: { id: true },
    })
  })

  it('prevents an unassigned asset subaccount from updating project material by id', async () => {
    authMock.mockResolvedValueOnce({
      session: {
        user: {
          id: 'owner-1',
          actorId: 'asset-1',
          workspaceOwnerId: 'owner-1',
          role: 'asset',
        },
      },
    })
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ ...globalMaterial, projectId: 'project-secret' })
    prismaMock.project.findFirst.mockResolvedValueOnce(null)

    const response = await PATCH(request('PATCH', { title: '越权修改' }), context)

    expect(response.status).toBe(404)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('moves an account-owned upload to trash with a CAS predicate and retains its storage object', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(authMock).toHaveBeenCalledWith(['assetWrite'])
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'material-1',
        userId: 'owner-1',
        projectId: 'global',
        source: 'upload',
        updatedAt,
        deletedAt: null,
      },
      data: {
        deletedAt: expect.any(Date),
        deletedById: 'owner-1',
        isFavorited: false,
      },
    })
    expect(prismaMock.canvas.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-1' },
    }))
    expect(prismaMock.canvasWorkflowTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-1' },
    }))
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it('never deletes the storage object while a trashed material can still be restored', async () => {
    prismaMock.frameosMaterial.count.mockResolvedValueOnce(1)
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.count).not.toHaveBeenCalled()
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it('restores a soft-deleted material with the same project ACL and optimistic revision', async () => {
    const deletedAt = new Date('2026-07-18T02:00:00.000Z')
    const deleted = { ...globalMaterial, deletedAt, deletedById: 'owner-1' }
    prismaMock.frameosMaterial.findFirst
      .mockResolvedValueOnce(deleted)
      .mockResolvedValueOnce(globalMaterial)

    const response = await PATCH(request('PATCH', { restore: true }), context)

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'material-1',
        userId: 'owner-1',
        projectId: 'global',
        updatedAt,
        deletedAt,
      },
      data: { deletedAt: null, deletedById: null },
    })
  })

  it('rejects deletion when durable canvas JSON still references the upload', async () => {
    prismaMock.canvas.findMany.mockResolvedValueOnce([{
      id: 'canvas-current',
      nodes: [{
        data: {
          materialId: 'material-1',
          history: [{ materialId: 'material-1' }],
        },
        studioDocument: null,
      }],
      snapshots: [{
        id: 'snapshot-2',
        document: { nodes: [{ data: { referenceMaterialIds: ['material-1'] } }] },
        studioDocuments: [],
      }],
    }])
    prismaMock.canvasWorkflowTemplate.findMany.mockResolvedValueOnce([{
      id: 'template-3',
      nodes: [{ data: { materialId: 'material-1' } }],
      edges: [],
      studioDocuments: [],
    }])

    const response = await DELETE(request('DELETE'), context)
    const payload = await response.json() as {
      message?: string
      referenceCounts?: Record<string, number>
    }

    expect(response.status).toBe(409)
    expect(payload.message).toContain('1 个当前画布、1 个工作流模板')
    expect(payload.referenceCounts).toEqual({
      currentCanvases: 1,
      workflowTemplates: 1,
      historySnapshots: 1,
    })
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it('allows deletion when only durable history snapshots reference the upload', async () => {
    prismaMock.canvas.findMany.mockResolvedValueOnce([{
      id: 'canvas-history',
      nodes: [{ data: { prompt: '不包含素材引用' }, studioDocument: null }],
      snapshots: [{
        id: 'snapshot-history',
        document: { nodes: [{ data: { referenceMaterialIds: ['material-1'] } }] },
        studioDocuments: [{ document: { materialId: 'material-1' } }],
      }],
    }])

    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'material-1', deletedAt: null }),
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    }))
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it('prevents an unassigned asset subaccount from deleting project material by id', async () => {
    authMock.mockResolvedValueOnce({
      session: {
        user: {
          id: 'owner-1',
          actorId: 'asset-1',
          workspaceOwnerId: 'owner-1',
          role: 'asset',
        },
      },
    })
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ ...globalMaterial, projectId: 'project-secret' })
    prismaMock.project.findFirst.mockResolvedValueOnce(null)

    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(404)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it('rejects deletion of generated project materials', async () => {
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({
      ...globalMaterial,
      projectId: 'project-1',
      source: 'production',
      storageKey: 'project/output.png',
    })
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(403)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it('returns the explicit assetWrite denial before reading the material', async () => {
    authMock.mockResolvedValueOnce(NextResponse.json({ message: 'forbidden' }, { status: 403 }))

    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(403)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('keeps another member personal material indistinguishable from an unknown id', async () => {
    authMock.mockResolvedValueOnce({ session: { user: { id: 'owner-1', actorId: 'member-1', workspaceOwnerId: 'owner-1', role: 'asset' } } })
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ ...globalMaterial, projectId: 'personal', personalOwnerId: 'member-2' })
    expect((await PATCH(request('PATCH', { title: '越权修改' }), context)).status).toBe(404)
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('does not expose a legacy personal record without a verified owner', async () => {
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ ...globalMaterial, projectId: 'personal', personalOwnerId: null })
    expect((await DELETE(request('DELETE'), context)).status).toBe(404)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('moves an owned personal material to an authorized project without copying it', async () => {
    const current = { ...globalMaterial, projectId: 'personal', personalOwnerId: 'owner-1' }
    const updated = { ...current, projectId: 'project-1', personalOwnerId: null, title: '共享角色' }
    prismaMock.frameosMaterial.findFirst.mockReset()
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
    const response = await PATCH(request('PATCH', { title: '共享角色', projectId: 'project-1' }), context)
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'material-1', projectId: 'personal', updatedAt }),
      data: { title: '共享角色', projectId: 'project-1', personalOwnerId: null },
    }))
    await expect(response.json()).resolves.toMatchObject({ material: { id: 'material-1', projectId: 'project-1', personal: false, canEdit: true } })
  })

  it('rejects moving a personal material to a project the actor cannot access', async () => {
    prismaMock.frameosMaterial.findFirst.mockReset()
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ ...globalMaterial, projectId: 'personal', personalOwnerId: 'owner-1' })
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    expect((await PATCH(request('PATCH', { projectId: 'project-secret' }), context)).status).toBe(404)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('clears only an inaccessible private voice when sharing its role card', async () => {
    const current = {
      ...globalMaterial, projectId: 'personal', personalOwnerId: 'owner-1', type: 'image',
      metadata: { assetCategory: 'character', voiceMaterialId: 'private-voice' },
    }
    const updated = { ...current, projectId: 'project-1', personalOwnerId: null, metadata: { assetCategory: 'character' } }
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(null).mockResolvedValueOnce(updated)
    const response = await PATCH(request('PATCH', { projectId: 'project-1' }), context)
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { projectId: 'project-1', personalOwnerId: null, metadata: { assetCategory: 'character' } },
    }))
    await expect(response.json()).resolves.toMatchObject({ voiceCleared: true, message: expect.stringContaining('已解除角色卡音色绑定'), material: { id: 'material-1' } })
  })

  it('keeps a shared voice when its role card moves into an accessible project', async () => {
    const current = {
      ...globalMaterial, projectId: 'personal', personalOwnerId: 'owner-1', type: 'image',
      metadata: { assetCategory: 'character', voiceMaterialId: 'shared-voice' },
    }
    const updated = { ...current, projectId: 'project-1', personalOwnerId: null }
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce({ id: 'shared-voice' }).mockResolvedValueOnce(updated)
    const response = await PATCH(request('PATCH', { projectId: 'project-1' }), context)
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { projectId: 'project-1', personalOwnerId: null },
    }))
    await expect(response.json()).resolves.toMatchObject({ voiceCleared: false })
  })

  it('does not let a shared-project editor move a shared upload into their personal pool', async () => {
    expect((await PATCH(request('PATCH', { projectId: 'personal' }), context)).status).toBe(403)
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })
})
