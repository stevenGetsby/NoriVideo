'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  MAX_REPAINT_BRIEF_CHARS,
  formatRepaintClock,
  outlineMissingSectionLabels,
  type RepaintOutlineTrack,
  type RepaintRunState,
  type RepaintStoryboardTrack,
  type RepaintTargetScriptTrack,
  type RepaintTrackStatus,
  type VideoUnderstandingEpisode,
} from './videoRepaintState'

const TRACK_STATUS_LABELS: Record<RepaintTrackStatus, string> = {
  queued: '排队',
  running: '进行中',
  done: '完成',
  failed: '失败',
}

const SOURCE_STAGE_STEPS = [
  { id: 'upload', label: '上传' },
  { id: 'preprocess', label: '预处理' },
  { id: 'analyze', label: '分析剧本' },
] as const

interface FosVideoRepaintProgressProps {
  state: Extract<RepaintRunState, 'processing' | 'review' | 'saving' | 'done'>
  title: string
  brief: string
  sourceFileName: string
  sourceReady: boolean
  sourceStage: 'upload' | 'preprocess' | 'analyze'
  sourceOutputChars: number
  elapsedSeconds: number
  source: VideoUnderstandingEpisode | null
  outline: RepaintOutlineTrack
  targetScript: RepaintTargetScriptTrack
  storyboard: RepaintStoryboardTrack
  savedScriptId: string
  onBriefChange: (value: string) => void
  onOutlineChange: (value: string) => void
  onTargetScriptChange: (value: string) => void
  onStoryboardChange: (value: string) => void
  onRetryOutline: () => void
  onRetryTargetScript: () => void
  onRetryStoryboard: () => void
  onRegenerateOutline: () => void
  onRegenerateStoryboard: () => void
  onReupload: () => void
  onCancelProcessing?: () => void
  onSave: () => void
  onGoWorkbench: () => void
}

function TrackBadge({ status }: { status: RepaintTrackStatus }) {
  return <span className={`rv2-track-badge rv2-track-badge--${status}`}>{TRACK_STATUS_LABELS[status]}</span>
}

function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}

function sourceDetail(props: FosVideoRepaintProgressProps): string {
  if (props.sourceReady && props.source) {
    return `原剧本 ${props.source.script.length} 字 · 检测到 ${props.source.cutHints.length} 个剪辑点 · 总长 ${formatRepaintClock(props.source.durationSeconds)}`
  }
  const stageCopy = props.sourceStage === 'upload'
    ? '正在上传视频…'
    : props.sourceStage === 'preprocess'
      ? '正在上传至理解服务并预处理视频…'
      : '正在反译原剧本，服务端正在流式生成结构化剧本…'
  const chars = props.sourceOutputChars > 0 ? ` · 已接收 ${props.sourceOutputChars.toLocaleString('zh-CN')} 字` : ''
  return `${stageCopy} 已用时 ${elapsedLabel(props.elapsedSeconds)}${chars}`
}

function storyboardCoverage(storyboard: RepaintStoryboardTrack, fallbackDuration: number): string {
  const total = storyboard.durationSeconds || fallbackDuration
  return `覆盖到 ${formatRepaintClock(storyboard.coveredSeconds)} / 总长 ${formatRepaintClock(total)}`
}

function storyboardDetail(storyboard: RepaintStoryboardTrack, fallbackDuration: number): string {
  const shots = `已 ${storyboard.shotCount} 镜`
  if (storyboard.status === 'queued') return '排队中 · 等待原剧本反译完成'
  if (storyboard.status === 'running') {
    return `第 ${Math.max(1, storyboard.round)} 轮 · ${shots} · ${storyboardCoverage(storyboard, fallbackDuration)}`
  }
  if (storyboard.status === 'failed') return storyboard.error
  return `完成 · ${shots} · ${storyboardCoverage(storyboard, fallbackDuration)}`
}

function targetScriptDetail(script: RepaintTargetScriptTrack): string {
  if (script.status === 'queued') return '排队中 · 等待目标设定总纲完成'
  if (script.status === 'running') return '文本模型正在按总纲撰写完整目标剧本…'
  if (script.status === 'failed') return script.error
  return `完成 · ${script.text.length} 字`
}

function outlineDetail(outline: RepaintOutlineTrack): string {
  if (outline.status === 'queued') return '排队中 · 等待原剧本反译完成'
  if (outline.status === 'running') return '文本模型正在按转绘需求撰写十章目标设定总纲…'
  if (outline.status === 'failed') return outline.error
  return `完成 · ${outline.text.length} 字${outline.missingSections.length ? ` · 缺少 ${outline.missingSections.length} 章` : ''}`
}

export function FosVideoRepaintProgress(props: FosVideoRepaintProgressProps) {
  const {
    state, title, brief, sourceFileName, sourceReady, sourceStage, source,
    outline, targetScript, storyboard, savedScriptId,
    onBriefChange, onOutlineChange, onTargetScriptChange, onStoryboardChange,
    onRetryOutline, onRetryTargetScript, onRetryStoryboard, onRegenerateOutline, onRegenerateStoryboard,
    onReupload, onCancelProcessing, onSave, onGoWorkbench,
  } = props
  const [activeDoc, setActiveDoc] = useState<'script' | 'outline' | 'storyboard'>('script')

  if (state === 'done') {
    const cards = [
      targetScript.text.trim() ? `目标剧本 ${targetScript.text.length} 字` : '',
      outline.text.trim() ? `目标设定总纲 ${outline.text.length} 字` : '',
      storyboard.text.trim() ? `分镜 ${storyboard.text.length} 字（${storyboard.shotCount} 镜）` : '',
    ].filter(Boolean).join(' · ')
    return (
      <div className="rv2-done">
        <div className="rv2-done-inner">
          <span className="rv2-done-icon-wrap"><AppIcon name="check" className="rv2-done-icon" /></span>
          <h1 className="rv2-done-title">转绘文档已保存</h1>
          <p className="rv2-done-desc">目标剧本、目标设定总纲{storyboard.text.trim() ? '和分镜' : ''}已写入当前账号的“我的剧本”，其他账号不会看到这份内容。</p>
          <div className="rv2-done-cards">
            <article className="rv2-done-card rv2-done-card--source"><span>输入</span><strong>{sourceFileName || '单集视频'}</strong><small>已反译原剧本并检测真实剪辑点</small></article>
            <AppIcon name="arrowRight" className="rv2-done-arrow" />
            <article className="rv2-done-card rv2-done-card--target"><span>当前账号草稿</span><strong>{title}</strong><small>{cards || '文档已保存'}</small></article>
          </div>
          <div className="rv2-done-actions"><button type="button" className="rv2-done-btn" onClick={onGoWorkbench}>返回编剧工作台</button></div>
          <p className="rv2-local-note">草稿 ID：{savedScriptId}</p>
        </div>
      </div>
    )
  }

  if (state === 'processing') {
    return (
      <div className="rv2-review-page rv2-progress-page" role="status" aria-live="polite" aria-busy="true">
        <header className="rv2-review-header">
          <div>
            <div className="rv2-review-kicker"><span className="rv2-project-type-badge">单集视频转绘</span><span>{sourceFileName}</span></div>
            <h1>{title}</h1>
            <p>目标设定总纲与目标剧本由文本模型依次生成；分镜为可选产物，可与它们并行生成。</p>
          </div>
        </header>

        <section className="rv2-track-list">
          <article className={`rv2-track-card rv2-track-card--source${sourceReady ? ' is-done' : ' is-running'}`}>
            <div className="rv2-track-head">
              <div className="rv2-track-title"><span className="rv2-track-index">A</span><strong>原剧本反译</strong></div>
              <TrackBadge status={sourceReady ? 'done' : 'running'} />
            </div>
            <div className="rv2-stage-steps" aria-label="原剧本反译阶段">
              {SOURCE_STAGE_STEPS.map((step, index) => {
                const activeIndex = SOURCE_STAGE_STEPS.findIndex((item) => item.id === sourceStage)
                const done = sourceReady || index < activeIndex
                const active = !sourceReady && index === activeIndex
                return <span key={step.id} className={`rv2-stage-step${done ? ' is-done' : ''}${active ? ' is-active' : ''}`}>{step.label}</span>
              })}
            </div>
            <p className="rv2-track-detail">{sourceDetail(props)}</p>
          </article>

          <article className={`rv2-track-card${outline.status === 'done' ? ' is-done' : ''}${outline.status === 'failed' ? ' is-failed' : ''}`}>
            <div className="rv2-track-head">
              <div className="rv2-track-title"><span className="rv2-track-index">B</span><strong>目标设定总纲</strong></div>
              <TrackBadge status={outline.status} />
            </div>
            <p className="rv2-track-detail">{outlineDetail(outline)}</p>
            {outline.status === 'failed' ? (
              <div className="rv2-track-actions">
                <button type="button" className="rv2-track-retry" onClick={onRetryOutline}><AppIcon name="refresh" className="h-3 w-3" />重试</button>
              </div>
            ) : null}
          </article>

          <article className={`rv2-track-card${targetScript.status === 'done' ? ' is-done' : ''}${targetScript.status === 'failed' ? ' is-failed' : ''}`}>
            <div className="rv2-track-head">
              <div className="rv2-track-title"><span className="rv2-track-index">C</span><strong>目标剧本</strong></div>
              <TrackBadge status={targetScript.status} />
            </div>
            <p className="rv2-track-detail">{targetScriptDetail(targetScript)}</p>
            {targetScript.status === 'failed' ? (
              <div className="rv2-track-actions">
                <button type="button" className="rv2-track-retry" onClick={onRetryTargetScript}><AppIcon name="refresh" className="h-3 w-3" />重试</button>
              </div>
            ) : null}
          </article>

          <article className={`rv2-track-card${storyboard.status === 'done' ? ' is-done' : ''}${storyboard.status === 'failed' ? ' is-failed' : ''}`}>
            <div className="rv2-track-head">
              <div className="rv2-track-title"><span className="rv2-track-index">D</span><strong>分镜（可选）</strong></div>
              <TrackBadge status={storyboard.status} />
            </div>
            <p className="rv2-track-detail">{storyboardDetail(storyboard, source?.durationSeconds ?? 0)}</p>
            {storyboard.status === 'failed' ? (
              <div className="rv2-track-actions">
                {storyboard.sessionExpired ? (
                  <button type="button" className="rv2-track-retry" onClick={onReupload}><AppIcon name="cloudUpload" className="h-3 w-3" />重新上传视频</button>
                ) : (
                  <button type="button" className="rv2-track-retry" onClick={onRetryStoryboard}><AppIcon name="refresh" className="h-3 w-3" />{storyboard.text.trim() ? '重试（继续）' : '重试'}</button>
                )}
              </div>
            ) : null}
          </article>
        </section>

        <div className="rv2-progress-actions">
          <span>请保持页面开启；长视频反译与多轮分镜可能需要数分钟。</span>
          {onCancelProcessing ? <button type="button" className="rv2-btn rv2-btn--secondary" onClick={onCancelProcessing}>取消本次处理</button> : null}
        </div>
      </div>
    )
  }

  const busy = state === 'saving'
  const hasDocument = Boolean(targetScript.text.trim() || outline.text.trim() || storyboard.text.trim())
  const activeScript = activeDoc === 'script'
  const activeOutline = activeDoc === 'outline'
  const outlineMissing = outlineMissingSectionLabels(outline.missingSections)
  const totalDuration = storyboard.durationSeconds || source?.durationSeconds || 0
  const visibleWarnings = storyboard.warnings.slice(0, 5)
  const hiddenWarnings = Math.max(0, storyboard.warnings.length - visibleWarnings.length)

  return (
    <div className="rv2-review-page" aria-busy={busy}>
      <header className="rv2-review-header">
        <div>
          <div className="rv2-review-kicker"><span className="rv2-project-type-badge">单集视频转绘</span><span>{sourceFileName}</span></div>
          <h1>{title}</h1>
          <p>目标剧本和总纲可分别编辑，源剧本可展开只读查看；分镜可在本次任务中随时生成。</p>
        </div>
        <div className="rv2-review-meta">
          <span><AppIcon name="check" className="h-3.5 w-3.5" />原稿反译完成</span>
          <span className={outline.status === 'done' ? '' : 'is-copy'}>总纲{TRACK_STATUS_LABELS[outline.status]}</span>
          <span className={targetScript.status === 'done' ? '' : 'is-copy'}>剧本{TRACK_STATUS_LABELS[targetScript.status]}</span>
          <span className={storyboard.status === 'done' ? '' : 'is-copy'}>分镜{TRACK_STATUS_LABELS[storyboard.status]}</span>
        </div>
      </header>

      <div className="rv2-doc-toolbar">
        <div className="rv2-doc-tabs" role="tablist" aria-label="转绘文档">
          <button type="button" role="tab" aria-selected={activeScript} className={activeScript ? 'active' : ''} onClick={() => setActiveDoc('script')}>
            目标剧本 <span className={`rv2-doc-tab-state rv2-doc-tab-state--${targetScript.status}`}>{TRACK_STATUS_LABELS[targetScript.status]}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeOutline} className={activeOutline ? 'active' : ''} onClick={() => setActiveDoc('outline')}>
            目标设定总纲 <span className={`rv2-doc-tab-state rv2-doc-tab-state--${outline.status}`}>{TRACK_STATUS_LABELS[outline.status]}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeDoc === 'storyboard'} className={activeDoc === 'storyboard' ? 'active' : ''} onClick={() => setActiveDoc('storyboard')}>
            分镜（可选） <span className={`rv2-doc-tab-state rv2-doc-tab-state--${storyboard.status}`}>{TRACK_STATUS_LABELS[storyboard.status]}</span>
          </button>
        </div>
        <div className="rv2-doc-facts">
          {activeScript
            ? <span>{targetScript.text.length} 字</span>
            : activeOutline
              ? <span>{outline.text.length} 字</span>
              : <><span>{storyboard.shotCount} 镜</span><span>{formatRepaintClock(storyboard.coveredSeconds)} / {formatRepaintClock(totalDuration)}</span></>}
        </div>
      </div>

      {activeScript ? (
        <section className="rv2-doc-panel">
          <div className="rv2-doc-actions">
            <div className="rv2-doc-actions-text">
              <strong>完整目标剧本</strong>
              <span>按总纲统一人物、场景与造型，逐镜写全镜头、画面、表情动作、光影和台词。</span>
            </div>
            <button type="button" className="rv2-btn rv2-btn--secondary" disabled={busy || targetScript.status === 'running' || !outline.text.trim()} onClick={onRetryTargetScript}><AppIcon name="refresh" className="h-3.5 w-3.5" />{targetScript.text.trim() ? '重新生成剧本' : '生成剧本'}</button>
          </div>
          {targetScript.status === 'running' ? <div className="rv2-doc-status"><AppIcon name="loader" className="h-3.5 w-3.5" />文本模型正在撰写完整目标剧本…</div> : null}
          {targetScript.status === 'failed' ? (
            <div className="rv2-doc-error" role="alert"><AppIcon name="alert" className="h-3.5 w-3.5" /><span>{targetScript.error}</span><button type="button" className="rv2-track-retry" onClick={onRetryTargetScript}>重试</button></div>
          ) : null}
          <div className="rv2-doc-panel-head">
            <div><strong>目标剧本</strong><span>可编辑 · {targetScript.text.length} 字</span></div>
          </div>
          <textarea
            className="rv2-doc-editor"
            aria-label="目标剧本"
            value={targetScript.text}
            spellCheck={false}
            disabled={targetScript.status === 'running'}
            placeholder={outline.text.trim() ? '尚未生成目标剧本。' : '目标设定总纲完成后会自动生成目标剧本。'}
            onChange={(event) => onTargetScriptChange(event.target.value)}
          />
        </section>
      ) : activeOutline ? (
        <section className="rv2-doc-panel">
          <div className="rv2-adaptation-bar">
            <div className="rv2-adaptation-bar-head">
              <label htmlFor="rv2-review-brief">转绘需求 <em>可选</em></label>
              <span>{brief.length} / {MAX_REPAINT_BRIEF_CHARS}</span>
            </div>
            <div className="rv2-adaptation-bar-row">
              <textarea id="rv2-review-brief" value={brief} maxLength={MAX_REPAINT_BRIEF_CHARS} rows={2} placeholder="目标市场、受众、语言、平台、人物命名、尺度……留空则沿用原剧本的市场和语言。" onChange={(event) => onBriefChange(event.target.value)} />
              <button type="button" className="rv2-btn rv2-btn--adapt" disabled={busy || outline.status === 'running' || targetScript.status === 'running'} onClick={onRegenerateOutline}><AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />重新生成总纲与剧本</button>
            </div>
            <p>留空时沿用原剧本的市场和语言；重新生成会依次覆盖尚未保存的总纲与目标剧本编辑内容。</p>
          </div>

          {outline.status === 'running' ? <div className="rv2-doc-status"><AppIcon name="loader" className="h-3.5 w-3.5" />文本模型正在重新撰写目标设定总纲…</div> : null}
          {outline.status === 'failed' ? (
            <div className="rv2-doc-error" role="alert">
              <AppIcon name="alert" className="h-3.5 w-3.5" />
              <span>{outline.error}</span>
              <button type="button" className="rv2-track-retry" onClick={onRetryOutline}><AppIcon name="refresh" className="h-3 w-3" />重试</button>
            </div>
          ) : null}
          {outlineMissing.length ? (
            <div className="rv2-doc-warning">
              <strong>总纲缺少以下章节</strong>
              <ul className="rv2-missing-list">{outlineMissing.map((label) => <li key={label}>{label}</li>)}</ul>
              <span>可点击“重新生成总纲与剧本”补齐。</span>
            </div>
          ) : null}

          <div className="rv2-doc-panel-head">
            <div><strong>目标设定总纲</strong><span>可编辑 · {outline.text.length} 字</span></div>
            {outline.model ? <span className="rv2-doc-model">文本模型 · {outline.model}</span> : null}
          </div>
          <textarea
            className="rv2-doc-editor"
            aria-label="目标设定总纲"
            value={outline.text}
            spellCheck={false}
            disabled={outline.status === 'running'}
            placeholder="尚未生成目标设定总纲。"
            onChange={(event) => onOutlineChange(event.target.value)}
          />
        </section>
      ) : (
        <section className="rv2-doc-panel">
          <div className="rv2-doc-actions">
            <div className="rv2-doc-actions-text">
              <strong>逐镜分镜</strong>
              <span>{storyboard.text.trim() ? '按剪辑点覆盖整段视频；“重新生成分镜”会从第一镜重新生成。' : '分镜不是必需产物；需要逐镜制作时再生成，不影响剧本与总纲保存。'}</span>
            </div>
            <button type="button" className="rv2-btn rv2-btn--secondary" disabled={busy || storyboard.status === 'running' || storyboard.sessionExpired || !sourceReady} onClick={onRegenerateStoryboard}><AppIcon name="refresh" className="h-3.5 w-3.5" />{storyboard.text.trim() ? '重新生成分镜' : '生成分镜'}</button>
          </div>

          <div className="rv2-doc-metrics">
            <span><strong>{storyboard.shotCount}</strong> 镜</span>
            <span>覆盖 <strong>{formatRepaintClock(storyboard.coveredSeconds)}</strong> / 总长 {formatRepaintClock(totalDuration)}</span>
          </div>

          {storyboard.status === 'running' ? (
            <div className="rv2-doc-status"><AppIcon name="loader" className="h-3.5 w-3.5" />{storyboardDetail(storyboard, totalDuration)}</div>
          ) : null}
          {storyboard.status === 'failed' ? (
            <div className="rv2-doc-error" role="alert">
              <AppIcon name="alert" className="h-3.5 w-3.5" />
              <span>{storyboard.error}</span>
              {storyboard.sessionExpired
                ? <button type="button" className="rv2-track-retry" onClick={onReupload}><AppIcon name="cloudUpload" className="h-3 w-3" />重新上传视频</button>
                : <button type="button" className="rv2-track-retry" onClick={onRetryStoryboard}><AppIcon name="refresh" className="h-3 w-3" />{storyboard.text.trim() ? '重试（继续）' : '重试'}</button>}
            </div>
          ) : null}
          {storyboard.status === 'done' && !storyboard.complete ? (
            <div className="rv2-doc-warning">
              <strong>分镜尚未覆盖完整视频</strong>
              <span>已覆盖 {formatRepaintClock(storyboard.coveredSeconds)} / 总长 {formatRepaintClock(totalDuration)}，生成在多轮上限或无新增镜头后结束。可点击“重新生成分镜”重新生成。</span>
            </div>
          ) : null}
          {storyboard.warnings.length ? (
            <details className="rv2-warning-details">
              <summary>校验提示 {storyboard.warnings.length} 条</summary>
              <ul>{visibleWarnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
              {hiddenWarnings ? <p>还有 {hiddenWarnings} 条</p> : null}
            </details>
          ) : null}

          <div className="rv2-doc-panel-head">
            <div><strong>分镜</strong><span>可编辑 · {storyboard.text.length} 字</span></div>
          </div>
          <textarea
            className="rv2-doc-editor rv2-doc-editor--mono"
            aria-label="分镜"
            value={storyboard.text}
            spellCheck={false}
            disabled={storyboard.status === 'running'}
            placeholder="尚未生成分镜。"
            onChange={(event) => onStoryboardChange(event.target.value)}
          />
        </section>
      )}

      {source ? (
        <details className="rv2-source-details">
          <summary>源剧本（只读）· {source.script.length} 字</summary>
          <pre className="rv2-script-source rv2-source-details-body">{source.script || '未提取到原剧本'}</pre>
        </details>
      ) : null}

      <footer className="rv2-review-actions">
        <div className="rv2-review-actions-note">确认后已生成的文档会写入当前账号的“我的剧本”；分镜可留空。</div>
        <div className="rv2-review-actions-main">
          <span>{hasDocument ? '未生成或留空的文档不会保存' : '至少需要一份文档才能保存'}</span>
          <button type="button" className="rv2-btn rv2-btn--primary rv2-save-btn" disabled={busy || !hasDocument} onClick={onSave}>
            {busy ? <AppIcon name="loader" className="h-3.5 w-3.5" /> : <AppIcon name="check" className="h-3.5 w-3.5" />}
            {busy ? '正在保存…' : '确认并保存为草稿'}
          </button>
        </div>
      </footer>
    </div>
  )
}
