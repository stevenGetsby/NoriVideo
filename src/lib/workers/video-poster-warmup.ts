import { createScopedLogger } from '@/lib/logging/core'
import { ensureVideoPoster } from '@/lib/media/video-poster'

const logger = createScopedLogger({ module: 'worker.video-poster' })

export function warmVideoPoster(storageKey: string): void {
  void ensureVideoPoster(storageKey, 480).catch((error: unknown) => {
    logger.warn('视频封面预热失败。', { storageKey }, error)
  })
}
