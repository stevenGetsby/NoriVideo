import { describe, expect, it, vi } from 'vitest'
import { captureVideoFrame, videoFrameCaptureFileName } from '@/features/canvas/video-frame-capture'

function video(overrides: Record<string, unknown> = {}) {
  return {
    readyState: 2,
    videoWidth: 1920,
    videoHeight: 1080,
    currentTime: 12.345,
    title: '',
    pause: vi.fn(),
    ...overrides,
  } as unknown as HTMLVideoElement
}

function canvas(context: Partial<CanvasRenderingContext2D> | null = {}) {
  const drawImage = vi.fn()
  const toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(['frame'], { type: 'image/jpeg' })))
  return {
    element: { width: 0, height: 0, getContext: vi.fn(() => context === null ? null : { drawImage, ...context }), toBlob } as unknown as HTMLCanvasElement,
    drawImage,
    toBlob,
  }
}

describe('video current-frame capture', () => {
  it('captures native-resolution JPEG at the current playback position', async () => {
    const source = video()
    const target = canvas()
    const file = await captureVideoFrame(source, () => target.element, '雨夜 / 第一场')
    expect(source.pause).toHaveBeenCalledOnce()
    expect(target.element.width).toBe(1920)
    expect(target.element.height).toBe(1080)
    expect(target.drawImage).toHaveBeenCalledWith(source, 0, 0, 1920, 1080)
    expect(file).toMatchObject({ name: '雨夜 - 第一场-关键帧-12.35s.jpg', type: 'image/jpeg' })
  })

  it.each([{ readyState: 1 }, { videoWidth: 0 }, { videoHeight: 0 }])('rejects an unavailable frame without touching canvas: %o', async (overrides) => {
    const source = video(overrides)
    const target = canvas()
    await expect(captureVideoFrame(source, () => target.element)).rejects.toThrow('视频画面尚未加载')
    expect(target.element.getContext).not.toHaveBeenCalled()
  })

  it('reports an unusable 2D canvas and never starts upload', async () => {
    await expect(captureVideoFrame(video(), () => canvas(null).element)).rejects.toThrow('当前浏览器无法截取视频画面')
  })

  it('reports protected cross-origin video instead of returning a blank image', async () => {
    const target = canvas({ drawImage: vi.fn(() => { throw new DOMException('tainted', 'SecurityError') }) })
    await expect(captureVideoFrame(video(), () => target.element)).rejects.toThrow('当前视频不允许截取画面')
  })

  it('rejects failed JPEG encoding', async () => {
    const target = canvas()
    vi.mocked(target.element.toBlob).mockImplementation((callback: BlobCallback) => callback(null))
    await expect(captureVideoFrame(video(), () => target.element)).rejects.toThrow('视频画面编码失败')
  })

  it('uses safe names for invalid playback times', () => {
    expect(videoFrameCaptureFileName('', Number.NaN)).toBe('视频-关键帧-0.00s.jpg')
  })
})
