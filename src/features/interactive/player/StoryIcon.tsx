'use client'

import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'

const PICTURE_PROTOCOL = /^(https?:\/\/|data:image\/|blob:)/i
const STORAGE_PREFIX = /^(images|video|voice|toolbox-video-superresolved)\//i
const PICTURE_FILE = /[^/]+\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i

/** A creator's icon is either an emoji (shown as text) or a picture reference (shown as an image). */
export function isPictureIcon(icon: string): boolean {
  const value = icon.trim()
  if (!value) return false
  if (PICTURE_PROTOCOL.test(value) || STORAGE_PREFIX.test(value)) return true
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || PICTURE_FILE.test(value)
}

/** One value / shop icon: an emoji as text, any picture reference through the shared display() helper. */
export function StoryIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  const value = icon?.trim()
  if (!value) return null
  if (!isPictureIcon(value)) {
    return <span className={`nori-story-icon is-emoji${className ? ` ${className}` : ''}`} aria-hidden="true">{value}</span>
  }
  return <MediaImage src={toDisplayImageUrl(value) || value} alt="" className={`nori-story-icon is-picture${className ? ` ${className}` : ''}`} draggable={false} />
}
