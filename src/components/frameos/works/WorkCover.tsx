import Image from 'next/image'
import type { CSSProperties } from 'react'
import { AppIcon } from '@/components/ui/icons'
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
        <span className="work-cover-editor">
          <span className="work-cover-editor-head"><i /><i /><i /><b>STORYBOARD</b><AppIcon name="film" /></span>
          <span className="work-cover-editor-body">
            <span className="work-cover-shot"><i /><i /><i /><b /></span>
            <span className="work-cover-shot"><i /><i /><b /></span>
            <span className="work-cover-shot"><i /><i /><i /><b /></span>
          </span>
          <span className="work-cover-timeline"><b>01</b><i><em /><em /><em /><em /><em /></i><b>02</b></span>
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
