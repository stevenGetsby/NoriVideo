import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import { useId } from 'react'

interface AISparklesIconProps {
  className?: string
}

export default function AISparklesIcon({ className }: AISparklesIconProps) {
  const gradientId = useId().replace(/:/g, '')

  return (
    <Sparkles className={className} stroke={`url(#${gradientId})`}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8109ff" />
          <stop offset="52%" stopColor="#3265ff" />
          <stop offset="100%" stopColor="#3265ff" />
        </linearGradient>
      </defs>
    </Sparkles>
  )
}
