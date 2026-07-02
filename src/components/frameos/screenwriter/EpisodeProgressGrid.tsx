import { AppIcon } from '@/components/ui/icons'
import type { EpisodeProcessItem, EpisodeProcessStatus } from './types'

const STATUS_TEXT: Record<EpisodeProcessStatus, string> = {
  pending: '待处理',
  running: '整理中',
  succeeded: '完成',
  failed: '失败',
  retrying: '重试中',
}

export function EpisodeProgressGrid({
  title,
  description,
  episodes,
}: {
  title: string
  description: string
  episodes: EpisodeProcessItem[]
}) {
  const done = episodes.filter((episode) => episode.status === 'succeeded').length

  return (
    <section>
      <div className="mb-6">
        <h2 className="text-[18px] font-bold text-white">
          {title}
          <span className="ml-4 text-[13px] font-medium text-[var(--fos-text-3)]">{done} / {episodes.length} 集完成</span>
        </h2>
        <p className="mt-3 text-[13px] text-[var(--fos-text-3)]">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-6">
        {episodes.map((episode) => {
          const failed = episode.status === 'failed'
          return (
            <article
              key={episode.id}
              className="min-h-[68px] rounded-[8px] border bg-[var(--fos-bg-2)] p-3"
              style={{ borderColor: failed ? 'rgba(239,68,68,.55)' : 'rgba(59,130,246,.55)' }}
            >
              <div className="text-[13px] font-bold text-white">EP{String(episode.episodeNumber).padStart(2, '0')}</div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[12px] font-bold">
                <span className={failed ? 'text-[#f87171]' : 'text-[#60a5fa]'}>
                  <AppIcon name={failed ? 'alert' : 'loader'} className="mr-1 inline h-3.5 w-3.5" />
                  {STATUS_TEXT[episode.status]}
                </span>
                {failed ? <button type="button" className="text-[var(--fos-primary)]">重试</button> : null}
              </div>
              {episode.errorMessage ? <div className="mt-2 text-[12px] text-[#fca5a5]">{episode.errorMessage}</div> : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
