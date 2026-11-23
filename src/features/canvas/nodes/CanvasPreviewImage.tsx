'use client'

import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
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

export function CanvasPreviewImage({ src, onLoad, onError, ...props }: MediaImageProps) {
  const slot = usePreviewSlot(src)
  return (
    <MediaImage
      {...props}
      src={slot.src}
      onLoad={(event) => { slot.settle(); onLoad?.(event) }}
      onError={(event) => { slot.settle(); onError?.(event) }}
    />
  )
}

export function CanvasPosterImage({
  src,
  onError,
  ...props
}: { src: string; onError?: () => void } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'>) {
  const slot = usePreviewSlot(src)
  if (!slot.src) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={slot.src}
      alt={props.alt ?? ''}
      onLoad={slot.settle}
      onError={() => { slot.settle(); onError?.() }}
    />
  )
}
