'use client'

import { useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { LocalVideoItem, RepaintSetupErrors } from './videoRepaintState'

interface FosVideoRepaintSetupProps {
  title: string
  brief: string
  videos: LocalVideoItem[]
  errors: RepaintSetupErrors
  onTitleChange: (value: string) => void
  onBriefChange: (value: string) => void
  onFiles: (files: File[]) => void
  onRemoveVideo: (id: string) => void
  onSubmit: () => void
}

export function FosVideoRepaintSetup(props: FosVideoRepaintSetupProps) {
  const {
    title, brief, videos, errors,
    onTitleChange, onBriefChange, onFiles, onRemoveVideo, onSubmit,
  } = props
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const video = videos[0]

  const consumeInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(Array.from(event.target.files ?? []).slice(0, 1))
    event.target.value = ''
  }

  return (
    <form className="rv2-setup" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      <div className="rv2-setup-inner">
        <div className="rv2-flow-kicker"><span>1</span> 上传单集视频 <AppIcon name="arrowRight" className="h-3 w-3" /><span>2</span> 反译原剧本 <AppIcon name="arrowRight" className="h-3 w-3" /><span>3</span> 生成转绘剧本</div>
        <h1 className="rv2-setup-title">新建视频转绘</h1>
        <p className="rv2-setup-desc">当前一次上传一个视频，并固定作为一集处理。系统先忠实反译原稿，再按可选要求生成转绘稿。</p>

        <section className="rv2-section">
          <label className="rv2-label" htmlFor="rv2-title">任务名称</label>
          <div className="rv2-counted-field">
            <input id="rv2-title" className={`rv2-input${errors.title ? ' is-error' : ''}`} value={title} maxLength={40} placeholder="例：第 1 集海外本地化" onChange={(event) => onTitleChange(event.target.value)} />
            <span>{title.length} / 40</span>
          </div>
          <FieldError message={errors.title} />
        </section>

        <section className="rv2-section">
          <div className="rv2-section-head">
            <label className="rv2-label rv2-label--no-gap">单集成品视频</label>
            <span className="rv2-upload-summary">1 个视频 = 1 集</span>
          </div>
          <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/avi,.mp4,.mov,.avi" hidden onChange={consumeInput} />

          {!video ? (
            <button
              type="button"
              className={`rv2-upload-dropzone${dragOver ? ' is-dragover' : ''}${errors.videos ? ' is-error' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragOver(false)
                onFiles(Array.from(event.dataTransfer.files).slice(0, 1))
              }}
            >
              <span className="rv2-upload-icon-box"><AppIcon name="cloudUpload" className="rv2-upload-icon" /></span>
              <span className="rv2-upload-cta">选择或拖入一个视频</span>
              <span className="rv2-upload-hint">支持 mp4 / mov / avi，最大 512 MB<br />视频由后端安全转发至火山方舟进行理解</span>
            </button>
          ) : (
            <article className={`rv2-single-video${errors.videos ? ' is-error' : ''}`}>
              <video className="rv2-single-video-preview" src={video.url} muted controls preload="metadata" />
              <div className="rv2-single-video-info">
                <strong title={video.file.name}>{video.file.name}</strong>
                <span>{(video.file.size / 1024 / 1024).toFixed(1)} MB · 将作为第 1 集</span>
              </div>
              <button type="button" className="rv2-btn rv2-btn--secondary" onClick={() => fileInputRef.current?.click()}>替换视频</button>
              <button type="button" className="rv2-thumb-remove" aria-label={`移除 ${video.file.name}`} onClick={() => onRemoveVideo(video.id)}><AppIcon name="close" className="h-3.5 w-3.5" /></button>
            </article>
          )}
          <FieldError message={errors.videos} />
          <p className="rv2-upload-note rv2-upload-note--warn">请确保上传内容为本人创作或已获得合法授权。</p>
        </section>

        <section className="rv2-section">
          <div className="rv2-section-head">
            <label className="rv2-label rv2-label--no-gap" htmlFor="rv2-brief">转绘要求 <em>可选</em></label>
            <span className="rv2-char-count">{brief.length} / 800</span>
          </div>
          <textarea id="rv2-brief" className="rv2-textarea" value={brief} maxLength={800} rows={5} placeholder="例如：改为北美当代都市背景，角色使用英文名，对白更短更直接，保留原剧情因果和结尾钩子。" onChange={(event) => onBriefChange(event.target.value)} />
          <div className={`rv2-brief-behavior${brief.trim() ? ' is-adapt' : ' is-copy'}`}>
            <AppIcon name={brief.trim() ? 'sparklesAlt' : 'copy'} className="h-3.5 w-3.5" />
            {brief.trim()
              ? '将调用文本 LLM，把原剧本与这段要求组合生成转绘剧本。'
              : '未填写时不调用文本 LLM，转绘剧本将直接沿用原剧本。'}
          </div>
        </section>

        <div className="rv2-billing-card">
          <span className="rv2-billing-icon"><AppIcon name="coins" className="rv2-billing-icon-svg" /></span>
          <div className="rv2-billing-text">
            <p className="rv2-billing-title">按实际模型调用结算</p>
            <p className="rv2-billing-desc">视频理解会产生一次反译用量；仅在填写转绘要求时增加一次文本模型用量。</p>
          </div>
        </div>

        <div className="rv2-actions"><button type="submit" className="rv2-submit-btn">开始视频反译 <AppIcon name="arrowRight" className="rv2-submit-btn-icon" /></button></div>
      </div>
    </form>
  )
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="rv2-field-error" role="alert"><AppIcon name="alert" className="h-3.5 w-3.5" />{message}</p> : null
}
