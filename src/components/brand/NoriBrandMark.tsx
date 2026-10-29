import Image from 'next/image'
import { BRAND_ASSETS } from '@/lib/brand'

/** One transparent IP mark for public, workspace, admin and Agent surfaces. */
export function NoriBrandMark({ size = 34, className = '', alt = 'LanmiaoTV' }: {
  size?: number
  className?: string
  alt?: string
}) {
  return <Image
    src={BRAND_ASSETS.mark}
    alt={alt}
    width={size}
    height={size}
    unoptimized
    className={`nori-brand-mark ${className}`.trim()}
    style={{ width: size, height: size, objectFit: 'contain', display: 'block', flexShrink: 0 }}
  />
}
