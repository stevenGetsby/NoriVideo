'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { VideoRepaintCreateInput, VideoRepaintTransferForm, VideoRepaintUploadMode } from './types'

const CHECKPOINTS: Array<[string, string]> = [
  ['A', '设定总纲：审查提炼的设定，支持多轮 Feedback'],
  ['B', '目标设定总纲：审查转绘后的设定，支持多轮 Feedback'],
]

export function VideoRepaintCreateForm({
  onBack,
  onStart,
}: {
  onBack: () => void
  onStart: (input: VideoRepaintCreateInput) => void | Promise<void>
}) {
  const [taskTitle, setTaskTitle] = useState('')
  const [form, setForm] = useState<VideoRepaintTransferForm>('script')
  const [uploadTab, setUploadTab] = useState<VideoRepaintUploadMode>('file')
  const [sourceAssetName, setSourceAssetName] = useState('')
  const [requirement, setRequirement] = useState('')
  const [checks, setChecks] = useState<Record<string, boolean>>({ A: true, B: true })
  const [errors, setErrors] = useState<Partial<Record<keyof VideoRepaintCreateInput, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleStart = async () => {
    if (isSubmitting) return
    const result = validateVideoRepaintCreateInput({
      title: taskTitle,
      transferForm: form,
      uploadMode: uploadTab,
      sourceAssetName,
      requirement,
      checkpoints: { A: Boolean(checks.A), B: Boolean(checks.B) },
    })
    if (!result.valid) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await onStart(result.value)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '创建视频转绘任务失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[220px] flex-none flex-col border-r border-[var(--fos-border-soft)] bg-[rgba(255,255,255,.02)] p-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] text-[13px] font-bold text-[var(--fos-text-2)] hover:bg-[var(--fos-bg-3)]"
        >
          <AppIcon name="chevronLeft" className="h-4 w-4" />
          返回编剧工作台
        </button>
        <div className="mb-4 border-b border-[var(--fos-border-soft)] pb-3 text-[12px] font-bold text-[var(--fos-text-4)]">任务进度</div>
        {['自动拆集', '事实卡提取', '设定提炼', '逐集对齐', '目标设定', '逐集转绘'].map((title, index) => (
          <div key={title} className="flex items-start gap-3 rounded-[8px] px-2 py-2">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--fos-bg-4)] text-[13px] font-bold text-[var(--fos-text-disabled)]">
              {index + 1}
            </span>
            <span>
              <span className="block text-[13px] font-bold text-[var(--fos-text-2)]">{title}</span>
              <span className="block text-[12px] text-[var(--fos-text-4)]">待开始</span>
            </span>
          </div>
        ))}
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 py-8">
          <h1 className="text-[22px] font-bold text-white">新建视频转绘 2.0 任务</h1>
          <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">一键跑完「视频 → 源剧本 → 目标剧本」完整流程，中间设有检查点供人工审核。</p>

          <div className="mt-7 space-y-6">
            <div>
              <label className="mb-2 block text-[13px] font-bold text-white">任务名称</label>
              <input
                className="fos-input w-full"
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="例：夜色债 · 海外转绘版"
              />
              {errors.title ? <p className="mt-2 text-[12px] text-[#ef4444]">{errors.title}</p> : null}
            </div>

            <div>
              <label className="mb-2 block text-[13px] font-bold text-white">视频转译形式</label>
              <div className="grid grid-cols-2 gap-3">
                {([['script', '剧本', '视频 → 剧本 → 转绘剧本', 'fileText'], ['board', '分镜', '视频 → 分镜 → 转绘分镜', 'folderCards']] as const).map(([key, title, sub, icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm(key)}
                    className="flex items-center gap-3 rounded-[12px] border px-4 py-4 text-left"
                    style={{
                      borderColor: form === key ? 'var(--fos-primary)' : 'var(--fos-border-soft)',
                      background: form === key ? 'var(--fos-primary-soft)' : 'var(--fos-bg-2)',
                    }}
                  >
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-[var(--fos-fill-mid)] text-[var(--fos-primary)]">
                      <AppIcon name={icon} className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-[14px] font-bold text-white">{title}</span>
                      <span className="block text-[12px] text-[var(--fos-text-4)]">{sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[13px] font-bold text-white">参考视频</label>
                <span className="text-[12px] text-[var(--fos-text-4)]">{sourceAssetName || '待上传参考视频'}</span>
              </div>
              <div className="mb-3 flex gap-2">
                {(['file', 'folder'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setUploadTab(tab)}
                    className="rounded-[8px] px-3 py-1.5 text-[13px] font-bold"
                    style={{
                      background: uploadTab === tab ? 'var(--fos-primary-soft)' : 'var(--fos-fill-soft)',
                      color: uploadTab === tab ? 'var(--fos-primary)' : 'var(--fos-text-3)',
                    }}
                  >
                    {tab === 'file' ? '上传视频文件' : '上传文件夹'}
                  </button>
                ))}
              </div>
              <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-1)] py-14">
                <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--fos-primary-soft)] text-[var(--fos-primary)]">
                  <AppIcon name="videoWide" className="h-6 w-6" />
                </span>
                <div className="text-[14px] font-bold text-white">点击选择视频 / 拖拽视频文件至此</div>
                <div className="text-[12px] text-[var(--fos-text-4)]">支持 mp4 / mov / avi 格式，单个不超过 1 GB</div>
                <button
                  type="button"
                  onClick={() => setSourceAssetName(uploadTab === 'file' ? 'demo-episode-01.mp4' : 'demo-video-folder')}
                  className="rounded-[8px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] px-3 py-1.5 text-[12px] font-bold text-[var(--fos-text-2)] hover:bg-[var(--fos-bg-3)]"
                >
                  使用示例视频
                </button>
              </div>
              {errors.sourceAssetName ? <p className="mt-2 text-[12px] text-[#ef4444]">{errors.sourceAssetName}</p> : null}
              <p className="mt-2 text-[12px] text-[var(--fos-text-3)]">每个已上传视频将对应 1 集，可拖动卡片调整展示顺序，最终按集号升序参与流程。</p>
              <p className="mt-1 text-[12px] text-[#e0a23a]">请确保上传内容为您本人创作或已获得合法授权。</p>
            </div>

            <div>
              <label className="mb-2 block text-[13px] font-bold text-white">转绘需求</label>
              <textarea
                className="fos-textarea"
                style={{ minHeight: 120 }}
                value={requirement}
                onChange={(event) => setRequirement(event.target.value)}
                placeholder="例：输出英文版本，保留现代都市设定与情感冲突，角色命名和对白表达按海外短剧语境重写"
              />
              {errors.requirement ? <p className="mt-2 text-[12px] text-[#ef4444]">{errors.requirement}</p> : null}
            </div>

            <div>
              <label className="mb-3 block text-[13px] font-bold text-white">检查点配置</label>
              <div className="space-y-3">
                {CHECKPOINTS.map(([id, desc]) => (
                  <div key={id} className="flex items-center justify-between rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-4 py-3">
                    <div className="min-w-0 pr-4 text-[13px] text-[var(--fos-text-2)]">
                      <span className="font-bold text-white">{id}</span>　{desc}
                    </div>
                    <div className="flex flex-none gap-1.5">
                      <button
                        type="button"
                        onClick={() => setChecks((value) => ({ ...value, [id]: true }))}
                        className="rounded-[8px] px-3 py-1.5 text-[12px] font-bold"
                        style={{
                          background: checks[id] ? 'var(--fos-primary)' : 'transparent',
                          color: checks[id] ? '#fff' : 'var(--fos-text-3)',
                          border: checks[id] ? 'none' : '1px solid var(--fos-border-strong)',
                        }}
                      >
                        停下审核
                      </button>
                      <button
                        type="button"
                        onClick={() => setChecks((value) => ({ ...value, [id]: false }))}
                        className="rounded-[8px] px-3 py-1.5 text-[12px] font-bold"
                        style={{
                          background: !checks[id] ? 'var(--fos-fill-mid)' : 'transparent',
                          color: !checks[id] ? '#fff' : 'var(--fos-text-4)',
                          border: !checks[id] ? 'none' : '1px solid var(--fos-border-strong)',
                        }}
                      >
                        自动通过
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-[var(--fos-text-4)]">本次将有 {Object.values(checks).filter(Boolean).length} 个检查点需人工确认</p>
            </div>

            <div className="flex gap-3 rounded-[12px] border border-[var(--fos-border-soft)] bg-[rgba(59,110,242,.08)] p-4">
              <AppIcon name="infoCircle" className="h-5 w-5 flex-none text-[var(--fos-primary)]" />
              <div>
                <div className="text-[13px] font-bold text-white">后计费 · 按实际消耗结算</div>
                <p className="mt-1 text-[12px] leading-6 text-[var(--fos-text-3)]">提交后开始处理，进度可在本页查看；各 AI 环节将自动选用适合的模型进行按量计费，按实际消耗于完成后结算。</p>
              </div>
            </div>

            <div className="flex justify-end pb-4">
              {submitError ? <div className="mr-4 self-center text-[12px] text-[#ef4444]">{submitError}</div> : null}
              <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" onClick={handleStart} disabled={isSubmitting}>
                {isSubmitting ? '提交中' : '开始运行'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export type VideoRepaintCreateValidationResult =
  | { valid: true; value: VideoRepaintCreateInput }
  | { valid: false; errors: Partial<Record<keyof VideoRepaintCreateInput, string>> }

export function validateVideoRepaintCreateInput(input: VideoRepaintCreateInput): VideoRepaintCreateValidationResult {
  const value: VideoRepaintCreateInput = {
    ...input,
    title: input.title.trim(),
    sourceAssetName: input.sourceAssetName.trim(),
    requirement: input.requirement.trim(),
  }
  const errors: Partial<Record<keyof VideoRepaintCreateInput, string>> = {}

  if (!value.title) errors.title = '请输入任务名称'
  if (!value.sourceAssetName) errors.sourceAssetName = '请先选择参考视频'
  if (!value.requirement) errors.requirement = '请输入转绘需求'

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors }
  }
  return { valid: true, value }
}
