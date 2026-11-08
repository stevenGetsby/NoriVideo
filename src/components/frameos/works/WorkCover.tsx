import Image from 'next/image'
import type { CSSProperties } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { BRAND_ASSETS } from '@/lib/brand'
import { generativeCoverStyle } from '@/lib/ui/generative-cover'
import { projectAspectRatio } from './project-metadata'
import type { WorkProject } from './types'

export function WorkCover({
  project,
  compact = false,
}: {
  project: Pick<WorkProject, 'id' | 'coverImageUrl'> & Partial<Pick<WorkProject, 'name' | 'aspectRatio' | 'novelPromotionData'>>
  compact?: boolean
}) {
  const imageUrl = project.coverImageUrl?.trim() || null
  const ratio = projectAspectRatio(project as WorkProject) || '16:9'
  const resolution = project.novelPromotionData?.videoResolution?.trim() || null
  const episodes = project.novelPromotionData?.episodeCount || project.novelPromotionData?.targetEpisodeCount || null
  return (
    <span
      className={`work-cover${compact ? ' is-compact' : ''}${imageUrl ? ' has-cover' : ''}`}
      style={generativeCoverStyle(project.id) as CSSProperties}
      data-testid="work-generative-cover"
      aria-hidden="true"
    >
      {imageUrl ? <Image className="work-cover-image works-project-cover-image" src={imageUrl} alt="" fill unoptimized sizes="320px" /> : (
        <span className="work-cover-art">
          <span className="work-cover-orbit" />
          <span className="work-cover-brand">
            <Image src={BRAND_ASSETS.mark} alt="" width={38} height={32} unoptimized />
            <span>Lanmiao<b>TV</b></span>
          </span>
          <span className="work-cover-scene">
            <span className="work-cover-scene-number">01</span>
            <span className="work-cover-scene-visual"><i /><i /><b /></span>
            <span className="work-cover-scene-lines"><i /><i /></span>
          </span>
          <span className="work-cover-track"><i /><i /><i /><i /><i /><i /><i /></span>
          <span className="work-cover-caption"><AppIcon name="sparkles" />让故事发生</span>
        </span>
      )}
      <span className="work-cover-specs">
        <span><AppIcon name="monitor" />{ratio}</span>
        {resolution ? <span>{resolution}</span> : null}
        {episodes ? <span>{episodes} 集</span> : null}
      </span>
    </span>
  )
}
