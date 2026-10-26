'use client'

import { Link } from '@/i18n/navigation'
import type { FosProjectData } from '../useFosProject'

export function FosProductionEpisodes({ data }: { data: FosProjectData }) {
  const episodes = data.episodes
  const base = `/workflow/${data.projectId}/workbench-premium2`
  return (
    <div className="fos-scroll">
      <section className="px-6 py-6">
        <h2 className="mb-1 text-[16px] font-bold text-white">制作剪辑 · 选择分集</h2>
        <p className="mb-5 text-[13px] text-[var(--fos-text-3)]">每集包含“分镜生成”和“剪辑”两部分：先完成 Segment 视频，再进行整集组装、粗剪和提交评审。</p>
        <div className="overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)]">
          <div className="grid bg-[var(--fos-bg-3)] px-5 py-3 text-[12px] font-bold text-[var(--fos-text-3)]" style={{ gridTemplateColumns: '64px 1fr 140px 300px' }}>
            <div>序号</div><div>标题</div><div>状态</div><div>操作</div>
          </div>
          {episodes.map((episode) => {
            const failed = episode.status === 'failed'
            const ready = episode.status === 'completed' || episode.status === 'confirmed' || episode.status === 'approved'
            return (
              <div key={episode.id} className="grid items-center border-t border-[var(--fos-border-soft)] px-5 py-3.5 text-[13px]" style={{ gridTemplateColumns: '64px 1fr 140px 300px' }}>
                <div className="font-bold text-[#e5e5e5]">E{episode.episodeNumber}</div>
                <div className="truncate pr-4 font-bold text-white">{episode.name}</div>
                <div>{failed ? <span className="fos-status failed">制作异常</span> : ready ? <span className="fos-status done">可制作</span> : <span className="fos-status idle">待制作</span>}</div>
                <div className="flex gap-2">
                  <Link href={{ pathname: `${base}/production/shot`, query: { episode_id: episode.id } }} className="fos-btn fos-btn-primary fos-btn-sm">分镜生成</Link>
                  <Link href={{ pathname: `${base}/production/timeline`, query: { episode_id: episode.id } }} className="fos-btn fos-btn-ghost fos-btn-sm">剪辑</Link>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
