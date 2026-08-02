import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const uploadMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/frameos/material-upload', () => ({ uploadFrameosMaterial: uploadMock }))

import { POST } from '@/app/api/frameos/toolbox/materials/route'

describe('FrameOS toolbox reference upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireProjectAuthLight.mockResolvedValue({
      session: {
        user: {
          id: 'workspace-1',
          actorId: 'writer-1',
          role: 'writer',
          permissions: ['read', 'scriptWrite', 'toolboxUse'],
        },
      },
      project: { id: 'project-1', userId: 'workspace-1' },
    })
    uploadMock.mockResolvedValue(NextResponse.json({ success: true, material: { id: 'material-1' } }))
  })

  it('lets a toolbox-only role upload image, video, or audio references into the selected project', async () => {
    const request = buildMockRequest({
      path: '/api/frameos/toolbox/materials',
      method: 'POST',
      query: { projectId: 'project-1' },
    })
    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1', ['toolboxUse'])
    expect(uploadMock).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ user: expect.objectContaining({ actorId: 'writer-1' }) }),
      { expectedProjectId: 'project-1', projectAccessVerified: true },
    )
  })

  it('rejects an upload without a selected project before parsing the multipart body', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/materials',
      method: 'POST',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(authMock.requireProjectAuthLight).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('does not parse or store a file when toolbox authorization is denied', async () => {
    authMock.requireProjectAuthLight.mockResolvedValueOnce(
      NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    )
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/materials',
      method: 'POST',
      query: { projectId: 'project-1' },
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    expect(uploadMock).not.toHaveBeenCalled()
  })
})
