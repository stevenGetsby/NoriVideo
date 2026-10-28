'use client'

import { useState, type FormEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useDismissableDialog } from '@/components/ui/useDismissableDialog'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { APP_VERSION } from '@/lib/app-meta'
import { notify } from '@/lib/ui/feedback'

const FEEDBACK_TYPES = [
  ['bug', '页面问题'],
  ['quality', '生成质量'],
  ['workflow', '流程卡住'],
  ['idea', '改进建议'],
] as const
const FEEDBACK_LIMIT = 500

function ModalShell({ title, subtitle, width = 1000, dirty = false, busy = false, children, onClose }: { title: string; subtitle?: string; width?: number; dirty?: boolean; busy?: boolean; children: React.ReactNode; onClose: () => void }) {
  const { requestClose, onBackdropMouseDown } = useDismissableDialog({ onClose, dirty, busy })
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 p-6 pt-[12vh]" onMouseDown={onBackdropMouseDown}>
      <div className="w-full rounded-[12px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-6 shadow-2xl" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-[18px] font-bold text-white">{title}</h3>
            {subtitle ? <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">{subtitle}</p> : null}
          </div>
          <button type="button" aria-label="关闭" disabled={busy} onClick={() => void requestClose()} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fos-text-4)] hover:bg-[var(--fos-fill-mid)] hover:text-white">
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<(typeof FEEDBACK_TYPES)[number][0]>('bug')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const text = description.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: text.split('\n')[0].slice(0, 40),
          description: contact.trim() ? `${text}\n\n联系方式：${contact.trim()}` : text,
          route: `${window.location.pathname}${window.location.search}`,
          userAgent: navigator.userAgent,
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交失败，请稍后重试'))
      notify('感谢反馈，我们已收到', 'success')
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="提交反馈" subtitle="遇到问题或有想法都可以告诉我们，会自动附上当前页面信息" width={620} dirty={Boolean(text || contact.trim())} busy={submitting} onClose={onClose}>
      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <div>
          <div className="mb-2 text-[13px] font-bold text-white">反馈类型</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="反馈类型">
            {FEEDBACK_TYPES.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={type === value} onClick={() => setType(value)}
                className={`h-8 rounded-[8px] border px-3 text-[13px] transition-colors ${type === value ? 'border-white bg-white font-semibold text-black' : 'border-[var(--fos-border-strong)] text-[var(--fos-text-2)] hover:border-white/30 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-2 block text-[13px] font-bold text-white">详细描述</span>
          <span className="relative block">
            <textarea className="fos-textarea" style={{ minHeight: 150 }} maxLength={FEEDBACK_LIMIT} value={description} onChange={(event) => setDescription(event.target.value)} autoFocus
              placeholder="发生了什么？你期望的结果是什么？如果能复现，写下操作步骤会帮我们更快定位。" />
            <span className="pointer-events-none absolute bottom-2 right-3 text-[12px] text-[var(--fos-text-4)]">{description.length} / {FEEDBACK_LIMIT}</span>
          </span>
        </label>
        <label className="block">
          <span className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-bold text-white">联系方式</span>
            <span className="rounded bg-[var(--fos-fill-soft)] px-1.5 py-0.5 text-[11px] text-[var(--fos-text-4)]">选填</span>
          </span>
          <input className="fos-input" value={contact} onChange={(event) => setContact(event.target.value)} maxLength={80} placeholder="微信或邮箱，方便我们回复您" />
        </label>
        {error ? <div role="alert" className="rounded-[8px] border border-[rgba(229,72,77,.3)] bg-[rgba(229,72,77,.1)] px-3 py-2 text-[12px] text-[#ff8589]">{error}</div> : null}
        <div className="flex items-center justify-end gap-3">
          {!text ? <span className="mr-auto text-[12px] text-[var(--fos-text-4)]">填写描述后即可提交</span> : null}
          <button type="button" onClick={onClose} disabled={submitting} className="fos-btn fos-btn-ghost">取消</button>
          <button type="submit" disabled={!text || submitting} className="fos-btn fos-btn-primary">
            <AppIcon name={submitting ? 'loader' : 'arrowRight'} className={`h-3.5 w-3.5${submitting ? ' animate-spin' : ''}`} />{submitting ? '提交中…' : '提交反馈'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

export function AccountModal({ account, onLogout, onClose }: { account: string; onLogout: () => void; onClose: () => void }) {
  return (
    <ModalShell title="个人中心" width={620} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--fos-primary-soft)] text-white"><AppIcon name="userCircle" className="h-5 w-5" /></span>
            <span className="text-[15px] font-bold text-white">账号信息</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--fos-border-soft)] pt-4">
            <span className="text-[13px] text-[var(--fos-text-3)]">账号</span>
            <span className="text-[14px] font-bold text-white">{account}</span>
          </div>
        </div>
        <div className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[rgba(255,255,255,.1)] text-[#e5e5e5]"><AppIcon name="lock" className="h-5 w-5" /></span>
            <span className="text-[15px] font-bold text-white">登录密码</span>
          </div>
          <div className="border-t border-[var(--fos-border-soft)] pt-4">
            <div className="text-[13px] font-bold text-white">已设置登录密码</div>
            <div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">可使用账号+密码方式登录</div>
          </div>
        </div>
        <button type="button" onClick={onLogout} className="fos-btn fos-btn-ghost w-full border-[rgba(229,72,77,.3)] text-[#ff8589] hover:bg-[rgba(229,72,77,.1)]">
          <AppIcon name="logout" className="h-4 w-4" />退出当前账号
        </button>
      </div>
    </ModalShell>
  )
}

export function UpdatesToast({ onDone }: { onDone: () => void }) {
  useState(() => { setTimeout(onDone, 2200); return null })
  return (
    <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-[10px] border border-[#313131] bg-[#1f1f1f] px-4 py-2.5 text-[13px] text-white shadow-xl">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-black"><AppIcon name="check" className="h-3 w-3" /></span>
        当前已是最新版本 <span className="text-[var(--fos-text-3)]">v{APP_VERSION}</span>
      </div>
    </div>
  )
}
