import { EventEmitter } from 'node:events'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(),
  getSignedObjectUrl: vi.fn(),
  getStorageProvider: vi.fn(() => ({ kind: 'tos' })),
  uploadObject: vi.fn(),
}))
vi.mock('@/lib/storage', () => storage)
const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('sharp', () => ({ default: () => ({ webp: () => ({ toBuffer: async () => Buffer.from('webp') }) }) }))

import { ensureVideoPoster, normalizeVideoPosterWidth, videoPosterKey } from '@/lib/media/video-poster'

function processMock() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn>; exitCode: number | null }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => { child.exitCode = 137 })
  child.exitCode = null
  spawn.mockReturnValue(child)
  return child
}

describe('video poster generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.getSignedObjectUrl.mockResolvedValue('https://storage.test/video.mp4')
    storage.uploadObject.mockImplementation(async (_body, key) => key)
  })

  it('returns an existing derivative without invoking ffmpeg', async () => {
    storage.getObjectBuffer.mockResolvedValue(Buffer.from('poster'))
    await expect(ensureVideoPoster('video/existing.mp4', 480)).resolves.toBe(videoPosterKey('video/existing.mp4', 480))
    expect(spawn).not.toHaveBeenCalled()
    expect(normalizeVideoPosterWidth('960')).toBe(960)
    expect(normalizeVideoPosterWidth('other')).toBe(480)
  })

  it('uses the local file path without requesting a signed remote URL', async () => {
    const child = processMock()
    storage.getStorageProvider.mockReturnValueOnce({ kind: 'local' })
    storage.getObjectBuffer.mockRejectedValue(new Error('missing'))
    const pending = ensureVideoPoster('video/local.mp4', 480)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(spawn.mock.calls[0][1]).toContain(path.join(process.cwd(), 'data/uploads/video/local.mp4'))
    expect(storage.getSignedObjectUrl).not.toHaveBeenCalled()
    child.stdout.emit('data', Buffer.from('png'))
    child.emit('close', 0)
    await expect(pending).resolves.toBe(videoPosterKey('video/local.mp4', 480))
  })

  it('coalesces concurrent requests and persists one webp derivative', async () => {
    const child = processMock()
    storage.getObjectBuffer.mockRejectedValue(new Error('missing'))
    const first = ensureVideoPoster('video/concurrent.mp4', 480)
    const duplicate = ensureVideoPoster('video/concurrent.mp4', 480)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    child.stdout.emit('data', Buffer.from('png'))
    child.emit('close', 0)
    await expect(first).resolves.toBe(videoPosterKey('video/concurrent.mp4', 480))
    await expect(duplicate).resolves.toBe(videoPosterKey('video/concurrent.mp4', 480))
    expect(storage.uploadObject).toHaveBeenCalledWith(Buffer.from('webp'), videoPosterKey('video/concurrent.mp4', 480), 1, 'image/webp')
  })

  it('retries at frame zero and remembers a total failure for ten minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-11-15T08:00:00Z')
    const first = processMock()
    storage.getObjectBuffer.mockRejectedValue(new Error('missing'))
    const pending = ensureVideoPoster('video/short.mp4', 480)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    first.emit('close', 1)
    const retry = processMock()
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    expect(spawn.mock.calls[1][1]).toContain('0')
    retry.stdout.emit('data', Buffer.from('png'))
    retry.emit('close', 0)
    await expect(pending).resolves.toContain('images/posters/')

    const bad = ensureVideoPoster('video/bad.mp4', 480)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(3))
    const empty = spawn.mock.results[2].value
    empty.emit('close', 1)
    const emptyRetry = processMock()
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(4))
    emptyRetry.emit('close', 1)
    await expect(bad).rejects.toThrow()
    await expect(ensureVideoPoster('video/bad.mp4', 480)).rejects.toThrow()
    expect(spawn).toHaveBeenCalledTimes(4)
    vi.setSystemTime('2026-11-15T08:10:01Z')
    const expired = ensureVideoPoster('video/bad.mp4', 480)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(5))
    const recovered = spawn.mock.results[4].value
    recovered.stdout.emit('data', Buffer.from('png'))
    recovered.emit('close', 0)
    await expect(expired).resolves.toContain('images/posters/')
    vi.useRealTimers()
  })

  it('kills a stalled ffmpeg process at twenty seconds', async () => {
    vi.useFakeTimers()
    const child = processMock()
    storage.getObjectBuffer.mockRejectedValue(new Error('missing'))
    const pending = ensureVideoPoster('video/timeout.mp4', 480)
    const rejection = expect(pending).rejects.toThrow('视频封面生成超时。')
    await vi.advanceTimersByTimeAsync(0)
    expect(spawn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    vi.useRealTimers()
  })
})
