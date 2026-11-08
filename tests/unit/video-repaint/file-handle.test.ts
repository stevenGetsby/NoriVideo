import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createVideoRepaintFileHandle,
  isVideoRepaintFileHandleConfigured,
  verifyVideoRepaintFileHandle,
} from '@/lib/video-repaint/file-handle'

const payload = {
  userId: 'user-1',
  fileId: 'file-abc123',
  durationSeconds: 93.5,
  episodeNumber: 3,
}

describe('video repaint signed file handle', () => {
  const originalSecret = process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET

  beforeEach(() => {
    process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET = 'test-handle-secret'
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET
    else process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET = originalSecret
  })

  it('round-trips upload metadata for the owning account', () => {
    const token = createVideoRepaintFileHandle(payload)
    expect(token.split('.')).toHaveLength(2)
    expect(verifyVideoRepaintFileHandle(token, 'user-1')).toEqual({
      userId: 'user-1',
      fileId: 'file-abc123',
      durationSeconds: 93.5,
      episodeNumber: 3,
      expiresAt: expect.any(Number),
    })
    expect(isVideoRepaintFileHandleConfigured()).toBe(true)
  })

  it('rejects a handle that belongs to another account', () => {
    const token = createVideoRepaintFileHandle(payload)
    expect(verifyVideoRepaintFileHandle(token, 'user-2')).toBeNull()
  })

  it('rejects tampered metadata and signatures', () => {
    const token = createVideoRepaintFileHandle(payload)
    const [body, signature] = token.split('.') as [string, string]
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    const tamperedBody = Buffer.from(JSON.stringify({ ...decoded, fid: 'file-attacker' })).toString('base64url')

    expect(verifyVideoRepaintFileHandle(`${tamperedBody}.${signature}`, 'user-1')).toBeNull()
    expect(verifyVideoRepaintFileHandle(`${body}.${signature.slice(0, -1)}x`, 'user-1')).toBeNull()
    expect(verifyVideoRepaintFileHandle('not-a-token', 'user-1')).toBeNull()
  })

  it('rejects expired handles', () => {
    const issuedAt = 1_700_000_000_000
    const token = createVideoRepaintFileHandle(payload, { now: issuedAt, ttlMs: 1_000 })
    expect(verifyVideoRepaintFileHandle(token, 'user-1', { now: issuedAt + 999 })).not.toBeNull()
    expect(verifyVideoRepaintFileHandle(token, 'user-1', { now: issuedAt + 1_000 })).toBeNull()
  })

  it('refuses to sign invalid upload metadata', () => {
    expect(() => createVideoRepaintFileHandle({ ...payload, fileId: '' })).toThrow('VIDEO_REPAINT_FILE_HANDLE_INVALID')
    expect(() => createVideoRepaintFileHandle({ ...payload, durationSeconds: 0 })).toThrow('VIDEO_REPAINT_FILE_HANDLE_INVALID')
    expect(() => createVideoRepaintFileHandle({ ...payload, episodeNumber: 0 })).toThrow('VIDEO_REPAINT_FILE_HANDLE_INVALID')
  })

  it('fails closed when no signing secret is configured', () => {
    delete process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.API_ENCRYPTION_KEY
    expect(isVideoRepaintFileHandleConfigured()).toBe(false)
    expect(() => createVideoRepaintFileHandle(payload)).toThrow('VIDEO_REPAINT_FILE_HANDLE_SECRET_MISSING')
    expect(verifyVideoRepaintFileHandle('abc.def', 'user-1')).toBeNull()
  })
})
