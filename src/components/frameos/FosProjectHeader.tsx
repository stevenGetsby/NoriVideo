'use client'

import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'

const META_TAGS = ['剧情模式', '精品版 2.0', '9:16', '480x856', '仿真人']

export function FosProjectHeader({
  projectId,
  projectName,
  title,
  backTo,
}: {
  projectId: string
  projectName: string
  title?: string
  backTo?: string
}) {
  return (
    <div className="fos-stage-header">
      <Link
        href={{ pathname: backTo ?? `/workflow/${projectId}/workbench-premium2` }}
        className="fos-back-btn"
        aria-label="返回"
      >
        <AppIcon name="chevronLeft" className="h-4 w-4" />
      </Link>
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h1 className="text-[15px] font-bold text-white">{title ? `${title} · ${projectName}` : projectName}</h1>
        {META_TAGS.map((tag) => (
          <span key={tag} className="fos-meta-tag">{tag}</span>
        ))}
      </div>
    </div>
  )
}
