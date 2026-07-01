'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { demoEpisodes, demoStoryboard } from '../fosDemoData'
import type { FosStoryboardEpisode, FosStoryScene, FosStorySegment } from '../fosDemoData'
import type { FosProjectData } from '../useFosProject'

const FAILED = new Set([1, 2, 3])

function SegCard({ seg, selected, onSelect }: { seg: FosStorySegment; selected: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false)
  const tagCls = seg.intent === 'conflict' ? ' sd3-seg-tag--conflict' : seg.intent === 'reverse' ? ' sd3-seg-tag--reverse' : ''
  const groups: Array<['角色' | '物品' | '环境', string[]]> = (['角色', '物品', '环境'] as const).map((k) => [k, seg.refs.filter((r) => r.kind === k).map((r) => r.name)])
  return (
    <div className={`sd3-seg-card${selected ? ' is-selected' : ''}`} onClick={onSelect}>
      <div className="sd3-seg-head">
        <span className="sd3-seg-id">{seg.id}</span>
        <span className={`sd3-seg-tag${tagCls}`}>{seg.intentLabel}</span>
        <span className="sd3-seg-dur">{seg.duration}s</span>
        <span className="sd3-seg-actions">
          {seg.intent === 'reverse' ? <button className="sd3-seg-act-btn sd3-seg-act-btn--danger" title="删除">✕</button> : null}
          <button className="sd3-seg-act-btn" title="展开详情">›</button>
        </span>
      </div>
      <div className="sd3-seg-script-excerpt">
        <div className="sd3-seg-script-excerpt-hd">
          <button className="sd3-seg-script-excerpt-toggle" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}>
            <span className="sd3-seg-script-excerpt-caret">{open ? '⌄' : '›'}</span>
            <span className="sd3-seg-script-excerpt-label">剧本原文</span>
            {!open ? <span className="sd3-seg-script-excerpt-preview">{seg.scriptText}</span> : null}
          </button>
        </div>
        {open ? <div className="sd3-seg-fn" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: 'var(--fos-text-2)' }}>{seg.scriptText}</div> : null}
      </div>
      <div className="sd3-shot-asset-hint">
        {groups.map(([key, names]) => names.length ? (
          <span key={key} className="flex items-center gap-1.5" style={{ flexWrap: 'wrap' }}>
            <span className="sd3-shot-asset-key">{key}</span>
            {names.map((n) => <span key={n} className="sd3-shot-micro-chip">{n}</span>)}
          </span>
        ) : null)}
      </div>
    </div>
  )
}

const ASSET_QUOTA = '分镜参考素材配额： 参考图 5/9  ·  参考视频 0/3  ·  参考音频 0/3'

const SHOT_PROMPT = `开场状态：
环境：@陆府偏僻小院，日 - 阴，冷灰青绿黯淡调，<凛冽微风，枯叶飘落声，四周破败冷清的寂静底噪>。
站位关系：沈曼柔在小院中央破旧石桌旁立姿，苏晚卿在她身前被两名丫鬟死死按住被迫半跪。

Shot 1 · 3.0s
镜头：中远景，平视，缓慢后拉，标准 50mm，中景深保留全景，常速，稳定器固定。
画面：@沈曼柔 昂着下巴，带着贴身丫鬟毫不留恋地转身走向院门方向，只留下高傲刻薄的背影；失去钳制的 @苏晚卿 身体猛地一松，双手撑在满是灰土的地面上急促喘息。

Shot 2 · 3.0s
镜头：近景，高角度俯拍，固定，中长焦 85mm，浅景深焦在泥地上的令牌与手，常速。
画面：@苏晚卿 撑着地面极其缓慢地爬起，目光死死盯住泥土中变形的 @刻"陆"字玄铁令牌，沾着灰土的指尖一把抠住令牌边缘扣进掌心。`

function MentionText({ text }: { text: string }) {
  // render @mentions as inline blue tags
  const parts = text.split(/(@[^，。；：\s,]+)/g)
  return (
    <>
      {parts.map((p, i) => p.startsWith('@')
        ? <span key={i} className="tb-mention-tag">{p}</span>
        : <span key={i}>{p}</span>)}
    </>
  )
}

function RightPanel({ seg, scene }: { seg: FosStorySegment; scene: FosStoryScene }) {
  const groups: Array<['角色' | '物品' | '环境', string[]]> = (['角色', '物品', '环境'] as const).map((k) => [k, seg.refs.filter((r) => r.kind === k).map((r) => r.name)])
  return (
    <aside className="sd3-right">
      <div className="sd3-right-header">
        <span className="sd3-right-shot-id">{seg.id}</span>
        <span className="sd3-right-scene-name">{scene.location}</span>
        <span className="sd3-right-shot-dur">{seg.duration}s</span>
      </div>
      <div className="sd3-right-scroll">
        <section className="sd3-right-section sd3-right-section--assets">
          <div className="sd3-right-section-title" style={{ marginBottom: 8 }}>◎ 参考资产</div>
          <div className="sd3-ref-constraint">{ASSET_QUOTA}</div>
          {groups.map(([key, names]) => (
            <div key={key} className="sd3-asset-group">
              <div className="sd3-asset-group-label">{key}</div>
              <div className="sd3-asset-thumb-row">
                {names.map((n) => (
                  <div key={n} className="sd3-asset-thumb-card">
                    <div className="sd3-asset-thumb-img">
                      <AppIcon name={key === '角色' ? 'user' : key === '物品' ? 'package' : 'imageLandscape'} className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/12" />
                      <button className="sd3-asset-thumb-replace">替换</button>
                      <span className="sd3-asset-thumb-name">{n}</span>
                    </div>
                    {key === '角色' ? (
                      <div className="sd3-char-checks">
                        <span className="sd3-check-ui">出镜</span>
                        <span className="sd3-check-ui is-off">说话</span>
                      </div>
                    ) : null}
                  </div>
                ))}
                <button className="sd3-asset-add-btn"><AppIcon name="plus" className="h-4 w-4" /><span>添加</span></button>
              </div>
            </div>
          ))}
          <div className="mt-1 flex flex-col gap-2">
            <button className="fos-btn fos-btn-ghost w-full fos-btn-sm">参考前一镜视频</button>
            <button className="fos-btn fos-btn-ghost w-full fos-btn-sm">添加额外参考素材</button>
          </div>
        </section>

        <div className="sd3-right-divider" />

        <section className="sd3-right-section sd3-right-section--preset">
          <div className="sd3-right-section-title" style={{ marginBottom: 10 }}>◎ 输出参数</div>
          <div className="spp-row">
            <div className="spp-field"><span className="spp-field-label">视频模型</span><span className="fos-pill" style={{ height: 28 }}>Seedance 2.0</span></div>
            <div className="spp-field" style={{ flex: '1 1 0px', minWidth: 90 }}><span className="spp-field-label">分辨率</span><span className="fos-pill" style={{ height: 28 }}>480p</span></div>
            <div className="spp-field" style={{ flex: '1 1 0px', minWidth: 90 }}><span className="spp-field-label">视频秒数</span><span className="fos-pill" style={{ height: 28 }}>{seg.duration}s</span></div>
          </div>
        </section>

        <div className="sd3-right-divider" />

        <section className="sd3-right-section sd3-right-section--prompt">
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span className="sd3-right-section-title">◈ 视频提示词</span>
            <span className="sd3-prompt-charcount">{SHOT_PROMPT.length} 字</span>
          </div>
          <div className="sd3-prompt-textarea" style={{ maxHeight: 260, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
            <MentionText text={SHOT_PROMPT} />
          </div>
        </section>

        <div className="sd3-right-section sd3-right-section--style" style={{ paddingTop: 0 }}>
          <div className="sd3-right-section-title" style={{ marginBottom: 8 }}>◈ 画风描述</div>
          <textarea className="sd3-prompt-textarea" style={{ minHeight: 64 }} defaultValue="院线电影王家卫式光影交错与浅景深，Lomo 复古褪色暖橘调配 Halation 胶片光晕，Cinematic" />
        </div>
      </div>
    </aside>
  )
}

function StoryboardSuccess({ data, sb, activeEp, onSwitchEp }: {
  data: FosProjectData
  sb: FosStoryboardEpisode
  activeEp: number
  onSwitchEp: (n: number) => void
}) {
  const episodes = data.usingDemo ? demoEpisodes : data.episodes
  const [expanded, setExpanded] = useState(false)
  const [selectedSeg, setSelectedSeg] = useState(() => {
    const last = sb.scenes[sb.scenes.length - 1]?.segments
    return last?.[last.length - 1]?.id ?? sb.scenes[0]?.segments[0]?.id ?? ''
  })
  const visibleEps = expanded ? episodes : episodes.slice(0, 10)
  const epName = episodes.find((e) => e.episodeNumber === activeEp)?.name ?? ''

  let selScene = sb.scenes[0]
  let selSeg = selScene?.segments[0]
  for (const sc of sb.scenes) {
    const found = sc.segments.find((s) => s.id === selectedSeg)
    if (found) { selScene = sc; selSeg = found; break }
  }

  return (
    <div className="sd3-page">
      <div className="sd3-ep-tabs">
        <span className="sd3-ep-label">分集：</span>
        <div className="sd3-ep-tabs-body">
          {visibleEps.map((ep) => (
            <button key={ep.id} className={`sd3-ep-tab${ep.episodeNumber === activeEp ? ' is-active' : ''}`} onClick={() => onSwitchEp(ep.episodeNumber)}>
              E{ep.episodeNumber} {ep.name}
              {FAILED.has(ep.episodeNumber) ? <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff5f5f] px-1 text-[10px] text-white">!</span> : null}
            </button>
          ))}
        </div>
        {!expanded ? <button className="sd3-ep-toggle" onClick={() => setExpanded(true)}>展开全部 {episodes.length} 集</button> : null}
      </div>

      <div className="sd3-body">
        <div className="sd3-middle">
          <div className="sd3-mid-ep-header">
            <div className="min-w-0">
              <div className="sd3-ep-name">E{sb.episodeNumber} · {epName}</div>
              <div className="sd3-ep-meta">{sb.sceneCount} 场景 · {sb.segmentCount} 片段 · {sb.totalSeconds}秒</div>
            </div>
            <button className="sd3-redesign-entry-btn" style={{ marginLeft: 'auto' }}><AppIcon name="refresh" className="h-3.5 w-3.5" />重新设计本集分镜</button>
          </div>
          <div className="sd3-scene-nav-wrap">
            {sb.scenes.map((sc) => (
              <span key={sc.code} className="sd3-scene-anchor"><AppIcon name="folderOpen" className="h-3 w-3" />{sc.code} {sc.location}</span>
            ))}
          </div>
          <div className="sd3-scene-scroll">
            {sb.scenes.map((sc) => (
              <div key={sc.code} className="sd3-scene-block">
                <div className="sd3-sc-header">
                  <span className="sd3-sc-badge">{sc.code}</span>
                  <span className="sd3-sc-location">{sc.location}</span>
                  <span className="sd3-sc-env">{sc.env}</span>
                  <span className="sd3-sc-stats">{sc.segments.length} 段 · {sc.segments.reduce((a, s) => a + s.duration, 0)}s</span>
                </div>
                <div className="sd3-seg-list">
                  {sc.segments.map((seg) => (
                    <SegCard key={seg.id} seg={seg} selected={seg.id === selectedSeg} onSelect={() => setSelectedSeg(seg.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {selSeg && selScene ? <RightPanel seg={selSeg} scene={selScene} /> : null}
      </div>

      <div className="sd3-bottom">
        <div className="sd3-action-bar">
          <div className="sd3-action-bar-left">
            <button className="sd3-bottom-btn sd3-bottom-btn--outlined-primary"><AppIcon name="plus" className="h-3.5 w-3.5" />插入片段</button>
          </div>
          <div className="sd3-action-bar-right">
            <button className="sd3-bottom-btn sd3-bottom-btn--primary" disabled title="后端操作，演示已禁用"><AppIcon name="check" className="h-4 w-4" />确认本集分镜</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StoryboardFailed({ episodes, activeEp, onSwitchEp }: {
  episodes: FosProjectData['episodes']
  activeEp: number
  onSwitchEp: (n: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const visibleEps = expanded ? episodes : episodes.slice(0, 10)
  const SCENES: Array<[string, string]> = [['S01', '张秃子家破旧柴房'], ['S02', '城郊破旧土地庙']]

  return (
    <div className="sd3-page">
      <div className="sd3-ep-tabs">
        <span className="sd3-ep-label">分集：</span>
        <div className="sd3-ep-tabs-body">
          {visibleEps.map((ep) => (
            <button key={ep.id} className={`sd3-ep-tab${ep.episodeNumber === activeEp ? ' is-active' : ''}`} onClick={() => onSwitchEp(ep.episodeNumber)}>
              E{ep.episodeNumber} {ep.name}
              {FAILED.has(ep.episodeNumber) ? <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff5f5f] px-1 text-[10px] text-white">!</span> : null}
            </button>
          ))}
        </div>
        {!expanded ? <button className="sd3-ep-toggle" onClick={() => setExpanded(true)}>展开全部 {episodes.length} 集</button> : null}
      </div>
      <div className="fos-scroll">
        <section className="p-6">
          <div className="mb-6 flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#55201f] text-[18px] font-bold text-[#ff6969]">!</div>
            <div>
              <h2 className="text-[16px] font-bold text-[#4f85ff]">第 {activeEp} 集 · 分镜生成失败</h2>
              <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">部分步骤或场景生成失败，请在下方失败场景行点击重试；也可切换其他已完成的集预览。</p>
            </div>
          </div>
          <div className="mb-6 fos-card p-5">
            <div className="grid items-center gap-5" style={{ gridTemplateColumns: '1fr 100px 1fr' }}>
              <div className="rounded-[10px] border border-[#2c7f58] bg-[#13231b] p-4"><div className="text-[14px] font-bold text-white">片段切分</div><div className="mt-1 text-[13px] text-[var(--fos-text-3)]">已完成</div></div>
              <div className="h-px bg-[var(--fos-border-strong)]" />
              <div className="rounded-[10px] border border-[#833b3b] bg-[#2b1717] p-4"><div className="text-[14px] font-bold text-white">按场景编排镜头</div><div className="mt-1 text-[13px] text-[#ff7777]">失败</div></div>
            </div>
          </div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-[16px] font-bold text-white">场景并行进度</h3>
              <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">每个场景并行推进：场景分析 → 镜头编排 → 结果质检。</p>
            </div>
            <span className="rounded-[10px] border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-3 py-1.5 text-[13px] font-bold text-[#6ea0ff]">0/2 场景完成</span>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)]">
            <div className="grid bg-[var(--fos-bg-3)] px-5 py-3 text-[12px] font-bold text-[var(--fos-text-3)]" style={{ gridTemplateColumns: '64px 200px 1fr 1fr 1fr 160px' }}>
              <div>场景</div><div>场景名称</div><div>场景分析</div><div>镜头编排</div><div>结果质检</div><div />
            </div>
            {SCENES.map(([code, name]) => (
              <div key={code} className="grid items-center border-t border-[var(--fos-border-soft)] px-5 py-4 text-[13px] font-bold" style={{ gridTemplateColumns: '64px 200px 1fr 1fr 1fr 160px' }}>
                <div className="text-[#4f85ff]">{code}</div>
                <div className="truncate pr-4 text-white">{name}</div>
                <div className="text-[#5bd08f]">✓ 已完成</div>
                <div className="text-[#ff6767]">! 失败</div>
                <div className="text-[#ff6767]">! 失败</div>
                <div><button className="fos-btn fos-btn-danger fos-btn-sm" disabled title="按量计费，演示已禁用">重试 · 按量计费</button></div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-5 text-[12px] font-bold text-[var(--fos-text-3)]">
            <span className="text-[#5bd08f]">● 已完成</span><span className="text-[#4f85ff]">● 进行中</span><span>● 等待中</span><span className="text-[#ff6767]">● 失败</span>
          </div>
        </section>
      </div>
    </div>
  )
}

export function FosStoryboard({ data }: { data: FosProjectData }) {
  const episodes = data.usingDemo ? demoEpisodes : data.episodes
  const [activeEp, setActiveEp] = useState(demoStoryboard.episodeNumber)

  // success state when the active episode has a designed storyboard (demo: E4)
  const sb = activeEp === demoStoryboard.episodeNumber ? demoStoryboard : null
  if (sb) {
    return <StoryboardSuccess data={data} sb={sb} activeEp={activeEp} onSwitchEp={setActiveEp} />
  }

  return <StoryboardFailed episodes={episodes} activeEp={activeEp} onSwitchEp={setActiveEp} />
}
