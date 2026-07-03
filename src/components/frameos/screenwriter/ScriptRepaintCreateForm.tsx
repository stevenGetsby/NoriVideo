'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ScriptRepaintCreateInput, ScriptRepaintSourceInputMode } from './types'

const CHECKPOINTS: Array<[string, string]> = [
  ['A', '源设定总纲：审查人物、世界观、场景、风格和称呼归一'],
  ['B', '目标设定总纲：审查目标设定、源目标映射和改编规则'],
]

const STAGES = ['自动拆集', '事实卡提取', '设定提炼', '目标设定', '逐集转绘']
const UNIMPLEMENTED_HINT = '功能尚未实现'

export function ScriptRepaintCreateForm({
  onBack,
  onStart,
}: {
  onBack: () => void
  onStart: (input: ScriptRepaintCreateInput) => void | Promise<void>
}) {
  const [taskTitle, setTaskTitle] = useState('')
  const [sourceInputMode, setSourceInputMode] = useState<ScriptRepaintSourceInputMode>('paste')
  const [sourceScriptName, setSourceScriptName] = useState('')
  const [sourceScriptText, setSourceScriptText] = useState('')
  const [requirement, setRequirement] = useState('')
  const [checks, setChecks] = useState<Record<string, boolean>>({ A: true, B: true })
  const [errors, setErrors] = useState<Partial<Record<keyof ScriptRepaintCreateInput, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleStart = async () => {
    if (isSubmitting) return
    const result = validateScriptRepaintCreateInput({
      title: taskTitle,
      sourceInputMode,
      sourceScriptName,
      sourceScriptText,
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
      setSubmitError(err instanceof Error ? err.message : '创建剧本转绘任务失败')
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
        {STAGES.map((title, index) => (
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
        <div className="mx-auto max-w-[820px] px-8 py-8">
          <h1 className="text-[22px] font-bold text-white">新建剧本转绘 2.0 任务</h1>
          <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">从源剧本生成目标剧本，中间设有源设定与目标设定检查点。</p>

          <div className="mt-7 space-y-6">
            <div>
              <label className="mb-2 block text-[13px] font-bold text-white">任务名称</label>
              <input
                className="fos-input w-full"
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="例：夜色债 · 北美剧本转绘版"
              />
              {errors.title ? <p className="mt-2 text-[12px] text-[#ef4444]">{errors.title}</p> : null}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[13px] font-bold text-white">源剧本</label>
                <span className="text-[12px] text-[var(--fos-text-4)]">{sourceScriptName || '可粘贴全文或使用示例文本'}</span>
              </div>
              <div className="mb-3 flex gap-2">
                {(['paste', 'file', 'workspace'] as const).map((mode) => {
                  const disabled = mode !== 'paste'
                  return (
                    <span key={mode} title={disabled ? UNIMPLEMENTED_HINT : undefined}>
                      <button
                        type="button"
                        data-source-mode={mode}
                        disabled={disabled}
                        title={disabled ? UNIMPLEMENTED_HINT : undefined}
                        onClick={() => {
                          if (!disabled) setSourceInputMode(mode)
                        }}
                        className="rounded-[8px] px-3 py-1.5 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-55"
                        style={{
                          background: sourceInputMode === mode ? 'var(--fos-primary-soft)' : 'var(--fos-fill-soft)',
                          color: sourceInputMode === mode ? 'var(--fos-primary)' : 'var(--fos-text-3)',
                        }}
                      >
                        {mode === 'paste' ? '粘贴文本' : mode === 'file' ? '上传文本' : '从工作台选择'}
                      </button>
                    </span>
                  )
                })}
              </div>
              <textarea
                className="fos-textarea"
                style={{ minHeight: 220 }}
                value={sourceScriptText}
                onChange={(event) => setSourceScriptText(event.target.value)}
                placeholder="粘贴整部源剧本；系统会先自动拆集，再提取事实卡。"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSourceScriptName('demo-script.txt')
                    setSourceScriptText('第一集\n女主进入公司，发现男主正在处理危机。\n\n第二集\n两人因误会发生争执，家族秘密开始浮出水面。')
                    setSourceInputMode('paste')
                  }}
                  className="rounded-[8px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] px-3 py-1.5 text-[12px] font-bold text-[var(--fos-text-2)] hover:bg-[var(--fos-bg-3)]"
                >
                  使用示例剧本
                </button>
                <span className="text-[12px] text-[var(--fos-text-4)]">{sourceScriptText.trim().length} 字符</span>
              </div>
              {errors.sourceScriptText ? <p className="mt-2 text-[12px] text-[#ef4444]">{errors.sourceScriptText}</p> : null}
            </div>

            <div>
              <label className="mb-2 block text-[13px] font-bold text-white">转绘需求</label>
              <textarea
                className="fos-textarea"
                style={{ minHeight: 120 }}
                value={requirement}
                onChange={(event) => setRequirement(event.target.value)}
                placeholder="例：目标市场：北美；保留核心情感冲突，人物命名和对白按海外短剧语境重写。"
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

export type ScriptRepaintCreateValidationResult =
  | { valid: true; value: ScriptRepaintCreateInput }
  | { valid: false; errors: Partial<Record<keyof ScriptRepaintCreateInput, string>> }

export function validateScriptRepaintCreateInput(input: ScriptRepaintCreateInput): ScriptRepaintCreateValidationResult {
  const value: ScriptRepaintCreateInput = {
    ...input,
    title: input.title.trim(),
    sourceScriptName: input.sourceScriptName?.trim(),
    sourceScriptText: input.sourceScriptText.trim(),
    requirement: input.requirement.trim(),
  }
  const errors: Partial<Record<keyof ScriptRepaintCreateInput, string>> = {}

  if (!value.title) errors.title = '请输入任务名称'
  if (!value.sourceScriptText) errors.sourceScriptText = '请先填写源剧本'
  if (!value.requirement) errors.requirement = '请输入转绘需求'

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors }
  }
  return { valid: true, value }
}
