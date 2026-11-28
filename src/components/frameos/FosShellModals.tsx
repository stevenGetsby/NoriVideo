'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useDismissableDialog } from '@/components/ui/useDismissableDialog'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import {
  FeedbackImageUploader,
  collectFeedbackBrowserContext,
  useFeedbackAttachments,
} from '@/components/workspace/FeedbackImageUploader'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { APP_VERSION } from '@/lib/app-meta'
import { notify } from '@/lib/ui/feedback'
import { useNoriTheme } from '@/lib/theme/useNoriTheme'

const THEME_OPTIONS = [['dark', '深色'], ['light', '日间'], ['system', '跟随系统']] as const

const FEEDBACK_TYPES = [
  ['bug', '页面问题'],
  ['quality', '生成质量'],
  ['workflow', '流程卡住'],
  ['idea', '改进建议'],
] as const
const FEEDBACK_LIMIT = 2000

function ModalShell({ title, subtitle, width = 1000, dirty = false, busy = false, children, onClose }: { title: string; subtitle?: string; width?: number; dirty?: boolean; busy?: boolean; children: React.ReactNode; onClose: () => void }) {
  const { requestClose, onBackdropMouseDown } = useDismissableDialog({ onClose, dirty, busy })
  return (
    <ViewportDialogLayer>
      <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/55 p-6 pt-[8vh]" onMouseDown={onBackdropMouseDown}>
        <div className="w-full rounded-[12px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-6 shadow-2xl" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h3 className="text-[18px] font-bold text-[var(--fos-text-1)]">{title}</h3>
              {subtitle ? <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">{subtitle}</p> : null}
            </div>
            <button type="button" aria-label="关闭" disabled={busy} onClick={() => void requestClose()} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fos-text-4)] hover:bg-[var(--fos-fill-mid)] hover:text-[var(--fos-text-1)]">
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </ViewportDialogLayer>
  )
}

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<(typeof FEEDBACK_TYPES)[number][0]>('bug')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const uploader = useFeedbackAttachments()
  const { handleClipboardPaste } = uploader
  const text = description.trim()
  const canSubmit = Boolean((text || uploader.uploadedAttachments.length > 0) && !uploader.isUploading && !submitting)

  useEffect(() => {
    const onWindowPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || submitting) return
      if (handleClipboardPaste(event.clipboardData)) {
        event.preventDefault()
      }
    }
    window.addEventListener('paste', onWindowPaste)
    return () => window.removeEventListener('paste', onWindowPaste)
  }, [submitting, handleClipboardPaste])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    if (uploader.hasFailedUploads) {
      setError('有截图尚未上传成功，请点击重试或移除后再提交')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const finalDescription = text
        ? (contact.trim() ? `${text}\n\n联系方式：${contact.trim()}` : text)
        : (contact.trim() ? `（附图反馈）\n\n联系方式：${contact.trim()}` : '（附图反馈）')
      const finalTitle = text
        ? text.split('\n')[0].slice(0, 40)
        : `截图反馈（${uploader.uploadedAttachments.length} 张）`
      const response = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: finalTitle,
          description: finalDescription,
          route: `${window.location.pathname}${window.location.search}`,
          userAgent: navigator.userAgent,
          attachments: uploader.uploadedAttachments.map(({ key, mimeType, name, size, width, height }) => ({
            key,
            mimeType,
            name,
            size,
            width,
            height,
          })),
          context: collectFeedbackBrowserContext(APP_VERSION),
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
    <ModalShell
      title="提交反馈"
      subtitle="遇到问题或有想法都可以告诉我们，支持直接粘贴截图，会自动附上当前页面信息"
      width={660}
      dirty={Boolean(text || contact.trim() || uploader.items.length > 0)}
      busy={submitting || uploader.isUploading}
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)} onPaste={uploader.handleReactPaste}>
        <div>
          <div className="mb-2 text-[13px] font-bold text-[var(--fos-text-1)]">反馈类型</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="反馈类型">
            {FEEDBACK_TYPES.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={type === value} onClick={() => setType(value)}
                className={`h-8 rounded-[8px] border px-3 text-[13px] transition-colors ${type === value ? 'border-transparent bg-[var(--fos-brand-solid)] font-semibold text-on-brand' : 'border-[var(--fos-border-strong)] text-[var(--fos-text-2)] hover:border-[var(--fos-primary-border)] hover:text-[var(--fos-text-1)]'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-2 block text-[13px] font-bold text-[var(--fos-text-1)]">详细描述</span>
          <span className="relative block">
            <textarea className="fos-textarea" style={{ minHeight: 136 }} maxLength={FEEDBACK_LIMIT} value={description} onChange={(event) => setDescription(event.target.value)} autoFocus
              placeholder="发生了什么？你期望的结果是什么？可以直接按 Ctrl+V / ⌘+V 粘贴截图，附带操作步骤能帮我们更快定位修复。" />
            <span className="pointer-events-none absolute bottom-2 right-3 text-[12px] text-[var(--fos-text-4)]">{description.length} / {FEEDBACK_LIMIT}</span>
          </span>
        </label>
        <FeedbackImageUploader
          items={uploader.items}
          limitNotice={uploader.limitNotice}
          maxImages={uploader.maxImages}
          disabled={submitting}
          onAddFiles={uploader.addFiles}
          onRetry={uploader.retryItem}
          onRemove={uploader.removeItem}
        />
        <label className="block">
          <span className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-bold text-[var(--fos-text-1)]">联系方式</span>
            <span className="rounded bg-[var(--fos-fill-soft)] px-1.5 py-0.5 text-[11px] text-[var(--fos-text-4)]">选填</span>
          </span>
          <input className="fos-input" value={contact} onChange={(event) => setContact(event.target.value)} maxLength={80} placeholder="微信或邮箱，方便我们回复您" />
        </label>
        {error ? <div role="alert" className="rounded-[8px] border border-[rgba(229,72,77,.3)] bg-[rgba(229,72,77,.1)] px-3 py-2 text-[12px] text-[rgb(var(--nori-t-ff8589))]">{error}</div> : null}
        <div className="flex items-center justify-end gap-3">
          {!text && uploader.uploadedAttachments.length === 0 ? (
            <span className="mr-auto text-[12px] text-[var(--fos-text-4)]">
              {uploader.isUploading ? '正在上传截图…' : '填写描述或粘贴截图后即可提交'}
            </span>
          ) : uploader.isUploading ? (
            <span className="mr-auto text-[12px] text-[var(--fos-text-3)]">正在上传截图…</span>
          ) : null}
          <button type="button" onClick={onClose} disabled={submitting} className="fos-btn fos-btn-ghost">取消</button>
          <button type="submit" disabled={!canSubmit} className="fos-btn fos-btn-primary">
            <AppIcon name={submitting ? 'loader' : 'arrowRight'} className={`h-3.5 w-3.5${submitting ? ' animate-spin' : ''}`} />{submitting ? '提交中…' : '提交反馈'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

export function AccountModal({ account, onLogout, onClose }: { account: string; onLogout: () => void; onClose: () => void }) {
  const { preference, setPreference } = useNoriTheme()
  return (
    <ModalShell title="个人中心" width={620} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--fos-primary-soft)] text-on-brand"><AppIcon name="userCircle" className="h-5 w-5" /></span>
            <span className="text-[15px] font-bold text-[var(--fos-text-1)]">账号信息</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--fos-border-soft)] pt-4">
            <span className="text-[13px] text-[var(--fos-text-3)]">账号</span>
            <span className="text-[14px] font-bold text-[var(--fos-text-1)]">{account}</span>
          </div>
        </div>
        <div className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--fos-primary-soft)] text-[var(--fos-primary-text)]"><AppIcon name="lock" className="h-5 w-5" /></span>
            <span className="text-[15px] font-bold text-[var(--fos-text-1)]">登录密码</span>
          </div>
          <div className="border-t border-[var(--fos-border-soft)] pt-4">
            <div className="text-[13px] font-bold text-[var(--fos-text-1)]">已设置登录密码</div>
            <div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">可使用账号+密码方式登录</div>
          </div>
        </div>
        <div className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-5">
          <div className="mb-4 text-[15px] font-bold text-[var(--fos-text-1)]">外观</div>
          <div className="flex gap-2 border-t border-[var(--fos-border-soft)] pt-4" role="radiogroup" aria-label="外观">
            {THEME_OPTIONS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={preference === value} className={`fos-btn fos-btn-sm${preference === value ? ' is-active' : ''}`} onClick={() => setPreference(value)}>{label}</button>)}
          </div>
          <p className="mt-3 text-[12px] text-[var(--fos-text-4)]">只影响当前这台设备上的显示。</p>
        </div>
        <button type="button" onClick={onLogout} className="fos-btn fos-btn-ghost w-full border-red-400/20 text-red-300 hover:bg-red-400/10">
          <AppIcon name="logout" className="h-4 w-4" />退出当前账号
        </button>
      </div>
    </ModalShell>
  )
}

export function UpdatesToast({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2200)
    return () => window.clearTimeout(timer)
  }, [onDone])
  return (
    <ViewportDialogLayer>
      <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-[10px] border border-[rgba(34,197,94,.3)] bg-[rgba(20,40,28,.95)] px-4 py-2.5 text-[13px] text-white shadow-xl">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--nori-s-22c55e))] text-white"><AppIcon name="check" className="h-3 w-3" /></span>
          当前已是最新版本 <span className="text-white/70">v{APP_VERSION}</span>
        </div>
      </div>
    </ViewportDialogLayer>
  )
}
