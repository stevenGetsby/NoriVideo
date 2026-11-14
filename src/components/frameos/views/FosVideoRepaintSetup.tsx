'use client'

import { useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  MAX_REPAINT_BRIEF_CHARS,
  MAX_REPAINT_TITLE_CHARS,
  type LocalVideoItem,
  type RepaintSetupErrors,
} from './videoRepaintState'

interface FosVideoRepaintSetupProps {
  title: string
  brief: string
  generateStoryboard: boolean
  videos: LocalVideoItem[]
  errors: RepaintSetupErrors
  onTitleChange: (value: string) => void
  onBriefChange: (value: string) => void
  onGenerateStoryboardChange: (value: boolean) => void
  onFiles: (files: File[]) => void
  onRemoveVideo: (id: string) => void
  onSubmit: () => void
}

export function FosVideoRepaintSetup(props: FosVideoRepaintSetupProps) {
  const {
    title, brief, generateStoryboard, videos, errors,
    onTitleChange, onBriefChange, onGenerateStoryboardChange, onFiles, onRemoveVideo, onSubmit,
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
        <div className="rv2-flow-kicker"><span>1</span> 上传单集视频 <AppIcon name="arrowRight" className="h-3 w-3" /><span>2</span> 反译原剧本 <AppIcon name="arrowRight" className="h-3 w-3" /><span>3</span> 生成剧本 + 总纲</div>
        <h1 className="rv2-setup-title">新建视频转绘</h1>
        <p className="rv2-setup-desc">先生成可编辑的《目标剧本》和《目标设定总纲》；需要逐镜制作时，可同时或随后生成可选《分镜》。</p>

        <section className="rv2-section">
          <label className="rv2-label" htmlFor="rv2-title">任务名称</label>
          <div className="rv2-counted-field">
            <input id="rv2-title" className={`rv2-input${errors.title ? ' is-error' : ''}`} value={title} maxLength={MAX_REPAINT_TITLE_CHARS} placeholder="例：第 1 集海外本地化" onChange={(event) => onTitleChange(event.target.value)} />
            <span>{title.length} / {MAX_REPAINT_TITLE_CHARS}</span>
          </div>
          <FieldError message={errors.title} />
        </section>

        <section className="rv2-section">
          <div className="rv2-section-head">
            <label className="rv2-label rv2-label--no-gap">单集成品视频</label>
            <span className="rv2-upload-summary">1 个视频 = 剧本 + 总纲{generateStoryboard ? ' + 分镜' : ''}</span>
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
              <span className="rv2-upload-hint">支持 mp4 / mov / avi，最大 512 MB<br />视频由后端转发至受保护的视频理解服务</span>
            </button>
          ) : (
            <article className={`rv2-single-video${errors.videos ? ' is-error' : ''}`}>
              <video className="rv2-single-video-preview" src={video.url} muted controls preload="metadata" />
              <div className="rv2-single-video-info">
                <strong title={video.file.name}>{video.file.name}</strong>
                <span>{(video.file.size / 1024 / 1024).toFixed(1)} MB · 本次转绘的唯一视频</span>
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
            <label className="rv2-label rv2-label--no-gap" htmlFor="rv2-brief">转绘需求 <em>可选</em></label>
            <span className="rv2-char-count">{brief.length} / {MAX_REPAINT_BRIEF_CHARS}</span>
          </div>
          <textarea id="rv2-brief" className="rv2-textarea" value={brief} maxLength={MAX_REPAINT_BRIEF_CHARS} rows={5} placeholder="例如：面向中国视频号中老年受众的写实家庭伦理短剧，人物改成乡镇常见姓名，保留全部剧情功能。" onChange={(event) => onBriefChange(event.target.value)} />
          <div className={`rv2-brief-behavior${brief.trim() ? ' is-adapt' : ' is-copy'}`}>
            <AppIcon name={brief.trim() ? 'sparklesAlt' : 'copy'} className="h-3.5 w-3.5" />
            {brief.trim()
              ? '目标剧本和总纲会按目标市场、受众、语言、平台、人物命名和尺度要求撰写；分镜按原视频逐镜拆解。'
              : '留空时，目标剧本和总纲会沿用原剧本的市场、语言和剧情，只固化可制作的设定。'}
          </div>
        </section>

        <section className="rv2-section">
          <div className="rv2-section-head">
            <span className="rv2-label rv2-label--no-gap">输出内容</span>
            <span className="rv2-upload-summary">分镜可选，也能稍后生成</span>
          </div>
          <label className="rv2-brief-behavior">
            <input type="radio" name="repaint-output" checked={!generateStoryboard} onChange={() => onGenerateStoryboardChange(false)} />
            <span><strong>剧本 + 目标设定总纲</strong><br />文本模型依次生成总纲和完整目标剧本，不调用分镜模型。</span>
          </label>
          <label className="rv2-brief-behavior">
            <input type="radio" name="repaint-output" checked={generateStoryboard} onChange={() => onGenerateStoryboardChange(true)} />
            <span><strong>剧本 + 目标设定总纲 + 分镜</strong><br />同时启动视频模型按真实剪辑点多轮生成逐镜分镜。</span>
          </label>
        </section>

        <div className="rv2-billing-card">
          <span className="rv2-billing-icon"><AppIcon name="coins" className="rv2-billing-icon-svg" /></span>
          <div className="rv2-billing-text">
            <p className="rv2-billing-title">按实际模型调用结算</p>
            <p className="rv2-billing-desc">视频理解产生一次反译用量；目标设定总纲和目标剧本由文本模型分别生成，只有选择分镜时才调用视频模型多轮生成。</p>
          </div>
        </div>

        <div className="rv2-actions"><button type="submit" className="rv2-submit-btn">开始生成{generateStoryboard ? '剧本、总纲和分镜' : '剧本和总纲'} <AppIcon name="arrowRight" className="rv2-submit-btn-icon" /></button></div>
      </div>
    </form>
  )
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="rv2-field-error" role="alert"><AppIcon name="alert" className="h-3.5 w-3.5" />{message}</p> : null
}
