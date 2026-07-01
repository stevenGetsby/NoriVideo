'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'

export interface CreateProjectDraft {
  name: string
  projectLevel: 'Nori1.0'
  projectStyle: 'live-action' | 'anime'
  targetAudience: 'zh-platform' | 'global-platform'
  videoRatio: '9:16' | '16:9'
  videoResolution: '480p' | '720p'
  targetEpisodeDurationSeconds: 60 | 90 | 120
  artStylePrompt: string
  scriptFile: File | null
}

const STYLE_OPTIONS = [
  { value: 'live-action', label: '真人', desc: '写实短剧、真实演员、电影级光影' },
  { value: 'anime', label: '动漫', desc: '二次元短剧、稳定角色设定、精致赛璐璐' },
] as const
const AUDIENCE_OPTIONS = [
  { value: 'zh-platform', label: '中文平台', desc: '面向抖音、快手、小红书等中文视频消费者' },
  { value: 'global-platform', label: '出海平台', desc: '面向 TikTok、Reels、Shorts 等海外视频消费者' },
] as const
const RATIO_OPTIONS = [
  { value: '9:16', label: '竖版 9:16' },
  { value: '16:9', label: '横版 16:9' },
] as const
const RESOLUTION_OPTIONS = ['480p', '720p'] as const
const DURATION_OPTIONS = [60, 90, 120] as const

const DEFAULT_DRAFT: CreateProjectDraft = {
  name: '',
  projectLevel: 'Nori1.0',
  projectStyle: 'live-action',
  targetAudience: 'zh-platform',
  videoRatio: '9:16',
  videoResolution: '720p',
  targetEpisodeDurationSeconds: 90,
  artStylePrompt: '',
  scriptFile: null,
}

export function CreateProjectDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (draft: CreateProjectDraft, setStatus: (status: string) => void) => Promise<boolean> | boolean
}) {
  const [draft, setDraft] = useState<CreateProjectDraft>(DEFAULT_DRAFT)
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState('创建中…')
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof CreateProjectDraft>(key: K, value: CreateProjectDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim()) { setError('项目名称必填'); return }
    if (!draft.scriptFile) { setError('请上传 txt、docx 或 pdf 剧本文件'); return }
    setSubmitting(true)
    setSubmitStatus('创建项目…')
    setError(null)
    try {
      const ok = await onCreate(draft, setSubmitStatus)
      if (ok) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建项目失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fos-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="fos-dialog" style={{ maxWidth: 910 }} onSubmit={submit}>
        <div className="fos-dialog-head">
          <div className="fos-dialog-title">创建项目</div>
          <button type="button" className="fos-dialog-x" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="fos-dialog-body" style={{ display: 'grid', gap: 18 }}>
          <div>
            <label className="mb-2 flex items-center justify-between text-[13px] font-semibold text-white">
              项目名称
              <span className="text-[11px] text-[var(--fos-text-4)]">{draft.name.length} / 40</span>
            </label>
            <input
              className="fos-input" placeholder="请输入项目名称" autoFocus required value={draft.name}
              onChange={(e) => { set('name', e.target.value.slice(0, 40)); if (error) setError(null) }}
            />
          </div>

          <div>
            <div className="mb-2 text-[13px] font-semibold text-white">项目水准</div>
            <div className="rounded-[10px] border border-[var(--fos-primary)] bg-[var(--fos-primary-soft)] p-4 text-left">
              <div className="flex items-center gap-2 text-[14px] font-bold text-white">
                Nori1.0
                <span className="rounded bg-[#3b82f6] px-1.5 py-0.5 text-[9px] font-bold text-white">默认</span>
              </div>
              <div className="mt-1 text-[12px] text-[var(--fos-text-3)]">NoriVideo 当前统一生产流程。</div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[13px] font-semibold text-white">项目风格</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {STYLE_OPTIONS.map((option) => (
                <button type="button" key={option.value} onClick={() => set('projectStyle', option.value)}
                  className="rounded-[10px] border p-4 text-left transition-colors"
                  style={{
                    borderColor: draft.projectStyle === option.value ? 'var(--fos-primary)' : 'var(--fos-border-mid)',
                    background: draft.projectStyle === option.value ? 'var(--fos-primary-soft)' : 'var(--fos-bg-2)',
                  }}>
                  <div className="text-[14px] font-bold text-white">{option.label}</div>
                  <div className="mt-1 text-[12px] text-[var(--fos-text-3)]">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[13px] font-semibold text-white">目标受众</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {AUDIENCE_OPTIONS.map((option) => (
                <button type="button" key={option.value} onClick={() => set('targetAudience', option.value)}
                  className="rounded-[10px] border p-4 text-left transition-colors"
                  style={{
                    borderColor: draft.targetAudience === option.value ? 'var(--fos-primary)' : 'var(--fos-border-mid)',
                    background: draft.targetAudience === option.value ? 'var(--fos-primary-soft)' : 'var(--fos-bg-2)',
                  }}>
                  <div className="text-[14px] font-bold text-white">{option.label}</div>
                  <div className="mt-1 text-[12px] text-[var(--fos-text-3)]">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-white">画面比例</div>
              <div className="fos-seg">
                {RATIO_OPTIONS.map((option) => (
                  <button type="button" key={option.value} onClick={() => set('videoRatio', option.value)}
                    className={`fos-seg-opt${draft.videoRatio === option.value ? ' active' : ''}`}>{option.label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-white">分辨率</div>
              <div className="fos-seg">
                {RESOLUTION_OPTIONS.map((option) => (
                  <button type="button" key={option} onClick={() => set('videoResolution', option)}
                    className={`fos-seg-opt${draft.videoResolution === option ? ' active' : ''}`}>{option}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-white">单集目标时长</div>
              <div className="fos-seg">
                {DURATION_OPTIONS.map((option) => (
                  <button type="button" key={option} onClick={() => set('targetEpisodeDurationSeconds', option)}
                    className={`fos-seg-opt${draft.targetEpisodeDurationSeconds === option ? ' active' : ''}`}>{option}s</button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[13px] font-semibold text-white">本地上传剧本</div>
            <label className="fos-dropzone cursor-pointer" style={{ minHeight: 110 }}>
              <input
                type="file"
                accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  set('scriptFile', e.currentTarget.files?.[0] ?? null)
                  if (error) setError(null)
                }}
              />
              {draft.scriptFile ? (
                <>
                  <AppIcon name="fileText" className="h-7 w-7" />
                  <div className="text-[13px] font-semibold text-[var(--fos-text-2)]">{draft.scriptFile.name}</div>
                  <div className="text-[11px]">点击可更换文件</div>
                </>
              ) : (
                <>
                <AppIcon name="cloudUpload" className="h-7 w-7" />
                <div className="text-[13px] font-semibold text-[var(--fos-text-2)]">上传剧本或拖拽到此处</div>
                <div className="text-[11px]">支持 txt / docx / pdf，单个不超过 10MB</div>
                </>
              )}
            </label>
          </div>

          <div>
            <div className="mb-2 text-[13px] font-semibold text-white">画风参考</div>
            <textarea className="fos-textarea" style={{ minHeight: 84 }} placeholder="可选。填写后会替代项目风格对应的默认全局画风提示词。"
              value={draft.artStylePrompt} onChange={(e) => set('artStylePrompt', e.target.value)} />
          </div>

          {error ? <div className="rounded-[10px] border border-[rgba(239,68,68,.4)] bg-[rgba(239,68,68,.1)] px-3 py-2 text-[13px] font-semibold text-[#ff7777]">{error}</div> : null}
        </div>
        <div className="fos-dialog-foot">
          <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose}>取消</button>
          <button type="submit" className="fos-btn fos-btn-primary fos-btn-lg" disabled={submitting || !draft.name.trim()}>
            {submitting ? submitStatus : '确认创建并进入工作台'}
          </button>
        </div>
      </form>
    </div>
  )
}
