'use client'

import { memo, useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { MediaImage, type MediaImageProps } from '@/components/media/MediaImage'
import { previewLoader } from '../preview-loader'

// A card only starts fetching its preview once a loader slot is free, so a burst of mounted cards cannot flood the network.
export function usePreviewSlot(src: string | null | undefined) {
  const [grantedSrc, setGrantedSrc] = useState<string | null>(null)
  const releaseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!src) return
    const release = previewLoader.request(() => setGrantedSrc(src))
    releaseRef.current = release
    return () => {
      release()
      if (releaseRef.current === release) releaseRef.current = null
    }
  }, [src])

  const settle = useCallback(() => releaseRef.current?.(), [])
  return { src: src && grantedSrc === src ? src : null, settle }
}

export const CanvasPreviewImage = memo(function CanvasPreviewImage({ src, onLoad, onError, draggable = false, ...props }: MediaImageProps) {
  const slot = usePreviewSlot(src)
  return (
    <MediaImage
      {...props}
      draggable={draggable}
      src={slot.src}
      onLoad={(event) => { slot.settle(); onLoad?.(event) }}
      onError={(event) => { slot.settle(); onError?.(event) }}
    />
  )
})

export const CanvasPosterImage = memo(function CanvasPosterImage({
  src,
  onError,
  draggable = false,
  ...props
}: { src: string; onError?: () => void } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'>) {
  const slot = usePreviewSlot(src)
  if (!slot.src) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      draggable={draggable}
      src={slot.src}
      alt={props.alt ?? ''}
      onLoad={slot.settle}
      onError={() => { slot.settle(); onError?.() }}
    />
  )
})
