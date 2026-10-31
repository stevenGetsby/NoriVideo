export function videoFrameCaptureFileName(title: string, currentTime: number): string {
  const base = title.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 100) || '视频'
  const seconds = Number.isFinite(currentTime) ? Math.max(0, currentTime).toFixed(2) : '0.00'
  return `${base}-关键帧-${seconds}s.jpg`
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
  title = '视频',
): Promise<File> {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('视频画面尚未加载，请稍后再试')
  }
  video.pause()
  const canvas = createCanvas()
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法截取视频画面')
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
  } catch {
    throw new Error('当前视频不允许截取画面，请先将视频上传到资产库')
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('视频画面编码失败，请重试')
  return new File([blob], videoFrameCaptureFileName(title, video.currentTime), { type: 'image/jpeg' })
}
