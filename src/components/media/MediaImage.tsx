'use client'

import type { CSSProperties, ImgHTMLAttributes, MouseEventHandler } from 'react'

export type MediaImageProps = {
  src: string | null | undefined
  alt: string
  className?: string
  style?: CSSProperties
  onClick?: MouseEventHandler<HTMLImageElement>
  fill?: boolean
  width?: number
  height?: number
  sizes?: string
  priority?: boolean
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'width' | 'height'>

export function MediaImage({
  src,
  alt,
  className,
  style,
  onClick,
  fill = false,
  width = 1200,
  height = 1200,
  sizes,
  priority = false,
  ...imgProps
}: MediaImageProps) {
  // width/height/sizes are accepted for API compatibility but the plain <img>
  // below intentionally does not forward them as attributes.
  void width
  void height
  void sizes
  if (!src) return null

  // Use plain <img> for all sources to avoid Next.js image optimizer issues in Docker
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style } : style}
      onClick={onClick}
      loading={priority ? 'eager' : 'lazy'}
      {...imgProps}
    />
  )
}
