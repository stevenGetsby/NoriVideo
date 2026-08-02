'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { RepaintResultMode, RepaintRunState } from './videoRepaintState'

interface FosVideoRepaintProgressProps {
  state: Extract<RepaintRunState, 'adapting' | 'review' | 'saving' | 'done'>
  title: string
  brief: string
  sourceScript: string
  sourceStoryboard: string
  targetScript: string
  sourceFileName: string
  sourceModel: string
  targetModel: string
  resultMode: RepaintResultMode
  usage: { inputTokens: number; outputTokens: number }
  savedScriptId: string
  onBriefChange: (value: string) => void
  onTargetScriptChange: (value: string) => void
  onRegenerate: () => void
  onRestoreSource: () => void
  onSave: () => void
  onGoWorkbench: () => void
}

export function FosVideoRepaintProgress(props: FosVideoRepaintProgressProps) {
  const {
    state, title, brief, sourceScript, sourceStoryboard, targetScript,
    sourceFileName, sourceModel, targetModel, resultMode, usage, savedScriptId,
    onBriefChange, onTargetScriptChange, onRegenerate, onRestoreSource, onSave, onGoWorkbench,
  } = props
  const [sourceView, setSourceView] = useState<'script' | 'storyboard'>('script')

  if (state === 'adapting') {
    return (
      <div className="rv2-live-stage" role="status" aria-live="polite" aria-busy="true">
        <span className="rv2-live-stage-icon"><AppIcon name="loader" className="h-7 w-7" /></span>
        <h1>正在生成转绘剧本</h1>
        <p>原剧本已经反译完成，文本 LLM 正在结合 adaptation contract 与你的转绘要求重写本集。</p>
        <div className="rv2-live-stage-pipeline"><span className="done">原视频</span><AppIcon name="arrowRight" className="h-3 w-3" /><span className="done">原剧本</span><AppIcon name="arrowRight" className="h-3 w-3" /><span className="active">转绘剧本</span></div>
        <small>请保持页面开启；不会把模型推理文本写入最终剧本。</small>
      </div>
    )
  }

  if (state === 'done') {
    return (
      <div className="rv2-done">
        <div className="rv2-done-inner">
          <span className="rv2-done-icon-wrap"><AppIcon name="check" className="rv2-done-icon" /></span>
          <h1 className="rv2-done-title">转绘剧本已保存</h1>
          <p className="rv2-done-desc">草稿只保存在当前登录账号下，其他账号不会看到这份内容。</p>
          <div className="rv2-done-cards">
            <article className="rv2-done-card rv2-done-card--source"><span>输入</span><strong>{sourceFileName || '单集视频'}</strong><small>已反译原剧本与原分镜</small></article>
            <AppIcon name="arrowRight" className="rv2-done-arrow" />
            <article className="rv2-done-card rv2-done-card--target"><span>当前账号草稿</span><strong>{title}</strong><small>{resultMode === 'source_copy' ? '未改编 · 沿用原剧本' : '文本 LLM 转绘完成'} · {targetScript.length} 字</small></article>
          </div>
          <div className="rv2-done-actions"><button type="button" className="rv2-done-btn" onClick={onGoWorkbench}>进入编剧工作台</button></div>
          <p className="rv2-local-note">草稿 ID：{savedScriptId}</p>
        </div>
      </div>
    )
  }

  const busy = state === 'saving'
  const sourceContent = sourceView === 'script' ? sourceScript : sourceStoryboard
  return (
    <div className="rv2-review-page" aria-busy={busy}>
      <header className="rv2-review-header">
        <div>
          <div className="rv2-review-kicker"><span className="rv2-project-type-badge">单集视频转绘</span><span>{sourceFileName}</span></div>
          <h1>{title}</h1>
          <p>左侧保留不可修改的反译依据，右侧是可编辑并最终保存的转绘剧本。</p>
        </div>
        <div className="rv2-review-meta">
          <span><AppIcon name="check" className="h-3.5 w-3.5" />原稿反译完成</span>
          <span className={resultMode === 'llm' ? 'is-llm' : 'is-copy'}>{resultMode === 'llm' ? 'LLM 转绘稿' : '与原剧本相同'}</span>
        </div>
      </header>

      <section className="rv2-adaptation-bar">
        <div className="rv2-adaptation-bar-head">
          <label htmlFor="rv2-review-brief">转绘要求 <em>可选</em></label>
          <span>{brief.length} / 800</span>
        </div>
        <div className="rv2-adaptation-bar-row">
          <textarea id="rv2-review-brief" value={brief} maxLength={800} rows={2} placeholder="留空则目标稿直接等于原剧本；填写后点击右侧按钮重新调用文本 LLM。" onChange={(event) => onBriefChange(event.target.value)} />
          <button type="button" className="rv2-btn rv2-btn--adapt" disabled={busy} onClick={onRegenerate}><AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />{brief.trim() ? '按当前要求重新生成' : '应用原剧本'}</button>
        </div>
        <p className={brief.trim() ? 'is-adapt' : 'is-copy'}>{brief.trim() ? '重新生成会覆盖右侧尚未保存的编辑内容。' : '当前无转绘要求：点击后不会调用文本 LLM。'}</p>
      </section>

      <div className="rv2-compare-grid">
        <section className="rv2-script-panel rv2-script-panel--source">
          <div className="rv2-script-panel-head">
            <div><strong>反译依据</strong><span>只读 · {sourceView === 'script' ? sourceScript.length : sourceStoryboard.length} 字</span></div>
            <div className="rv2-source-tabs" role="tablist" aria-label="反译依据">
              <button type="button" role="tab" aria-selected={sourceView === 'script'} className={sourceView === 'script' ? 'active' : ''} onClick={() => setSourceView('script')}>原剧本</button>
              <button type="button" role="tab" aria-selected={sourceView === 'storyboard'} className={sourceView === 'storyboard' ? 'active' : ''} onClick={() => setSourceView('storyboard')}>原分镜</button>
            </div>
          </div>
          <pre className="rv2-script-source">{sourceContent || (sourceView === 'storyboard' ? '未提取到原分镜' : '未提取到原剧本')}</pre>
          <footer><span>模型：{sourceModel || '火山视频理解'}</span></footer>
        </section>

        <section className="rv2-script-panel rv2-script-panel--target">
          <div className="rv2-script-panel-head">
            <div><strong>转绘剧本</strong><span>可编辑 · {targetScript.length} 字</span></div>
            <span className={`rv2-result-mode rv2-result-mode--${resultMode}`}>{resultMode === 'llm' ? '文本 LLM 生成' : '沿用原剧本'}</span>
          </div>
          <textarea className="rv2-script-editor" value={targetScript} spellCheck={false} placeholder="请先生成转绘剧本" onChange={(event) => onTargetScriptChange(event.target.value)} />
          <footer><span>{resultMode === 'llm' ? `模型：${targetModel || '火山文本模型'} · 输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} tokens` : '未调用文本模型，不产生转绘用量'}</span></footer>
        </section>
      </div>

      <footer className="rv2-review-actions">
        <div><button type="button" className="rv2-btn rv2-btn--secondary" disabled={busy} onClick={onRestoreSource}><AppIcon name="undo" className="h-3.5 w-3.5" />恢复为原剧本</button></div>
        <div className="rv2-review-actions-main"><span>确认后写入当前账号的“我的剧本”</span><button type="button" className="rv2-btn rv2-btn--primary" disabled={busy || !targetScript.trim()} onClick={onSave}>{busy ? <AppIcon name="loader" className="h-3.5 w-3.5" /> : <AppIcon name="check" className="h-3.5 w-3.5" />}{busy ? '正在保存…' : '确认并保存为草稿'}</button></div>
      </footer>
    </div>
  )
}
