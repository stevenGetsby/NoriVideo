'use client'

import { Clapperboard, GitBranch, Layers3, type IconComponent } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'

export type StoryLayer = 'story' | 'works' | 'production'

const LAYERS: Array<{ key: StoryLayer; label: string; hint: string; icon: IconComponent; path: (workId: string) => string }> = [
  { key: 'story', label: '剧情画布', hint: '故事、条件与分支', icon: GitBranch, path: (workId) => `/interactive/${encodeURIComponent(workId)}` },
  { key: 'works', label: '作品画布', hint: '线性片段与成片预览', icon: Layers3, path: (workId) => `/interactive/${encodeURIComponent(workId)}/works` },
  { key: 'production', label: '制作画布', hint: '下钻现有生成画布', icon: Clapperboard, path: (workId) => `/interactive/${encodeURIComponent(workId)}/production` },
]

/** The three layers share one strip so switching never hides which layer is active. */
export function StoryLayerNav({ workId, active }: { workId: string; active: StoryLayer }) {
  return (
    <nav className="nori-ix-layers" aria-label="影游三层画布" data-testid="story-layer-nav">
      {LAYERS.map((layer) => {
        const Icon = layer.icon
        return (
          <Link
            key={layer.key}
            href={layer.path(workId)}
            className={`nori-ix-layer${active === layer.key ? ' is-active' : ''}`}
            aria-current={active === layer.key ? 'page' : undefined}
            data-layer={layer.key}
          >
            <Icon />
            <span><strong>{layer.label}</strong><small>{layer.hint}</small></span>
          </Link>
        )
      })}
    </nav>
  )
}
