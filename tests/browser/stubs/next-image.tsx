import React from 'react'

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string
  fill?: boolean
  priority?: boolean
  unoptimized?: boolean
}

export default function Image({ fill, priority, unoptimized, style, alt = '', ...props }: Props) {
  void unoptimized
  // The auth asset is already unoptimized/static in production. This adapter
  // preserves Next Image's fill box without bundling the Next app runtime.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} style={{ ...(fill ? { position: 'absolute', height: '100%', width: '100%', inset: 0 } as const : {}), ...style }} fetchPriority={priority ? 'high' : props.fetchPriority} />
}
