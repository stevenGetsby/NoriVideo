import { logError as _ulogError } from '@/lib/logging/core'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'

interface UsePanelPlayerParams {
  videoRatio: string
  imageUrl?: string
  videoUrl?: string
  lipSyncVideoUrl?: string
  showLipSyncVideo: boolean
  onPreviewImage?: (imageUrl: string) => void
}

export function usePanelPlayer({
  videoRatio,
  imageUrl,
  videoUrl,
  lipSyncVideoUrl,
  showLipSyncVideo,
  onPreviewImage,
}: UsePanelPlayerParams) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cssAspectRatio = videoRatio.replace(':', '/')
  const currentVideoUrl = videoUrl
    ? (showLipSyncVideo && lipSyncVideoUrl ? lipSyncVideoUrl : videoUrl)
    : undefined

  useEffect(() => {
    setIsPlaying(false)
    setHasStartedPlayback(false)
  }, [currentVideoUrl])

  const handlePreviewImage = useCallback((event?: MouseEvent) => {
    if (event) event.stopPropagation()
    if (!imageUrl || !onPreviewImage) return
    onPreviewImage(imageUrl)
  }, [imageUrl, onPreviewImage])

  const handlePlayClick = useCallback(async () => {
    setHasStartedPlayback(true)
    setIsPlaying(true)
    window.requestAnimationFrame(async () => {
      if (!videoRef.current) return
      try {
        await videoRef.current.play()
      } catch (error: unknown) {
        if ((error as { name?: string }).name !== 'AbortError') {
          _ulogError('Video play error:', error)
        }
      }
    })
  }, [])

  const handleEnded = useCallback(() => {
    setIsPlaying(false)
  }, [])

  return {
    cssAspectRatio,
    currentVideoUrl,
    hasStartedPlayback,
    isPlaying,
    setIsPlaying,
    videoRef,
    handlePreviewImage,
    handlePlayClick,
    handleEnded,
  }
}
