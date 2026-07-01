'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'

export type ToolKey = 'video-repaint-2' | 'video2script' | 'video2board' | 'script2board' | 'board2board'

interface ToolCard {
  key: ToolKey
  title: string
  subtitle: string
  icon: AppIconName
  accent: string
  iconBg: string
  badge?: string
}

const TOOLS: ToolCard[] = [
  { key: 'video-repaint-2', title: '视频转绘2.0', subtitle: '整剧视频转为目标版本剧本/分镜\n保持全剧角色、场景映射一致', icon: 'sparklesAlt', accent: '#3b6ef2', iconBg: 'rgba(59,110,242,.16)', badge: 'NEW' },
  { key: 'video2script', title: '视频转剧本', subtitle: '上传参考视频，AI 分析画面节奏与对话，反向生成台词稿，适合改编或翻拍场景。', icon: 'videoWide', accent: '#3b82f6', iconBg: 'rgba(59,130,246,.16)' },
  { key: 'video2board', title: '视频转分镜', subtitle: '上传参考视频，AI 识别镜头切换点位与景别，输出镜头化文本，可叠加自动转绘。', icon: 'folderCards', accent: '#8b5cf6', iconBg: 'rgba(139,92,246,.16)' },
  { key: 'script2board', title: '剧本转绘', subtitle: '选择已有剧本或上传剧本文件，按目标市场规则生成转绘版剧本。', icon: 'sparkles', accent: '#22c55e', iconBg: 'rgba(34,197,94,.16)' },
  { key: 'board2board', title: '分镜转绘', subtitle: '选择已有分镜或上传分镜文件，按目标市场规则生成转绘版分镜。', icon: 'imageLandscape', accent: '#ec4899', iconBg: 'rgba(236,72,153,.16)' },
]

export function FosScreenwriter({ initialDialog }: { initialDialog?: ToolKey | null }) {
  const router = useRouter()
  const [dialog, setDialog] = useState<ToolKey | null>(initialDialog ?? null)

  const onCard = (key: ToolKey) => {
    if (key === 'video-repaint-2') {
      router.push({ pathname: '/screenwriter/video-repaint' })
      return
    }
    setDialog(key)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto flex max-w-[820px] flex-col gap-4">
        {TOOLS.map((t) => (
          <button key={t.key} onClick={() => onCard(t.key)}
            className="group relative flex items-center gap-5 overflow-hidden rounded-[16px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-6 py-5 text-left transition-colors hover:border-[var(--fos-border-mid)] hover:bg-[var(--fos-bg-3)]">
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: t.accent }} />
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[12px]" style={{ background: t.iconBg, color: t.accent }}>
              <AppIcon name={t.icon} className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[16px] font-bold text-white">{t.title}</span>
                {t.badge ? <span className="rounded bg-[#3b6ef2] px-1.5 py-0.5 text-[10px] font-bold text-white">{t.badge}</span> : null}
              </span>
              <span className="mt-1 block whitespace-pre-line text-[13px] leading-6 text-[var(--fos-text-3)]">{t.subtitle}</span>
            </span>
            <AppIcon name="chevronRight" className="h-5 w-5 flex-none text-[var(--fos-text-4)]" />
          </button>
        ))}
      </div>

      {dialog === 'video2script' ? <VideoToTextDialog mode="script" onClose={() => setDialog(null)} /> : null}
      {dialog === 'video2board' ? <VideoToTextDialog mode="board" onClose={() => setDialog(null)} /> : null}
      {dialog === 'script2board' ? <RepaintDialog mode="script" onClose={() => setDialog(null)} /> : null}
      {dialog === 'board2board' ? <RepaintDialog mode="board" onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

function DialogShell({ title, subtitle, children, footer, onClose }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onClick={onClose}>
      <div className="w-full max-w-[720px] rounded-[16px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-[18px] font-bold text-white">{title}</h3>
            <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">{subtitle}</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fos-text-4)] hover:bg-[var(--fos-fill-mid)] hover:text-white">
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>
        {children}
        <div className="mt-6 flex items-center justify-end gap-3">{footer}</div>
      </div>
    </div>
  )
}

function VideoToTextDialog({ mode, onClose }: { mode: 'script' | 'board'; onClose: () => void }) {
  const [tab, setTab] = useState<'file' | 'folder'>('file')
  const [auto, setAuto] = useState(false)
  const isScript = mode === 'script'
  return (
    <DialogShell
      title={isScript ? '视频转剧本' : '视频转分镜'}
      subtitle={isScript ? '上传视频素材，AI 先反译为剧本；可选在完成后自动转绘。' : '上传参考视频，AI 识别镜头切换与景别，输出分镜文本。'}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="fos-btn fos-btn-ghost">取消</button>
        <button className="fos-btn fos-btn-primary">下一步 →</button>
      </>}>
      <div className="space-y-5">
        <div>
          <label className="mb-2 block text-[13px] font-bold text-white">剧本名称<span className="ml-0.5 text-[#ef4444]">*</span></label>
          <div className="relative">
            <input className="fos-input" placeholder="例如 夜色归途" maxLength={40} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[var(--fos-text-4)]">0 / 40</span>
          </div>
        </div>
        <div>
          <label className="mb-2 block text-[13px] font-bold text-white">参考视频<span className="ml-0.5 text-[#ef4444]">*</span></label>
          <div className="mb-3 flex items-center gap-5 border-b border-[var(--fos-border-soft)]">
            {(['file', 'folder'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className="relative pb-2 text-[13px] font-bold"
                style={{ color: tab === t ? 'var(--fos-primary)' : 'var(--fos-text-3)' }}>
                {t === 'file' ? '上传视频文件' : '上传文件夹'}
                {tab === t ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}
              </button>
            ))}
          </div>
          <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-[var(--fos-primary-border)] py-10">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--fos-primary-soft)] text-[var(--fos-primary)]"><AppIcon name="playCircle" className="h-6 w-6" /></span>
            <div className="text-[14px] font-bold text-white">点击选择视频 / 拖拽视频文件至此</div>
            <div className="text-[12px] text-[var(--fos-text-4)]">支持 mp4 / mov / avi / mpeg / webm 等，单个 ≤ 100 MB</div>
          </div>
          <p className="mt-2 text-[12px] text-[var(--fos-text-3)]">上传的每个视频将被提取为一集；可拖动缩略图调整顺序。</p>
          <p className="mt-1 text-[12px] text-[var(--fos-text-4)]">请确保您上传的视频是您本人创作或拥有合法授权的内容。</p>
        </div>
        <div className="flex items-center justify-between rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] px-4 py-3">
          <div>
            <div className="text-[13px] font-bold text-white">自动转绘</div>
            <div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">{isScript ? '视频转剧本完成后，自动生成转绘版剧本' : '视频转分镜完成后，自动生成转绘版分镜'}</div>
          </div>
          <button onClick={() => setAuto((v) => !v)}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{ background: auto ? 'var(--fos-primary)' : 'var(--fos-bg-4)' }}>
            <span className="inline-block h-5 w-5 rounded-full bg-white transition-transform" style={{ transform: auto ? 'translateX(22px)' : 'translateX(2px)' }} />
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

function RepaintDialog({ mode, onClose }: { mode: 'script' | 'board'; onClose: () => void }) {
  const [tab, setTab] = useState<'workspace' | 'upload'>('workspace')
  const isScript = mode === 'script'
  return (
    <DialogShell
      title={isScript ? '剧本转绘' : '分镜转绘'}
      subtitle={isScript ? '选择已有剧本稿，AI 按目标市场规则生成转绘版剧本。' : '选择已有分镜稿，AI 按目标市场规则生成转绘版分镜。'}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="fos-btn fos-btn-ghost">取消</button>
        <button className="fos-btn fos-btn-primary">下一步 →</button>
      </>}>
      <div className="space-y-5">
        <div>
          <label className="mb-2 block text-[13px] font-bold text-white">剧本名称<span className="ml-0.5 text-[#ef4444]">*</span></label>
          <div className="relative">
            <input className="fos-input" placeholder="例如 夜色归途" maxLength={40} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[var(--fos-text-4)]">0 / 40</span>
          </div>
        </div>
        <div>
          <label className="mb-2 block text-[13px] font-bold text-white">{isScript ? '源剧本' : '源分镜'}<span className="ml-0.5 text-[#ef4444]">*</span></label>
          <div className="mb-3 flex items-center gap-5 border-b border-[var(--fos-border-soft)]">
            {(['workspace', 'upload'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className="relative pb-2 text-[13px] font-bold"
                style={{ color: tab === t ? 'var(--fos-primary)' : 'var(--fos-text-3)' }}>
                {t === 'workspace' ? '从工作台选择' : '上传文本'}
                {tab === t ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}
              </button>
            ))}
          </div>
          <button className="flex h-11 w-full items-center justify-between rounded-[8px] border border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)] px-3 text-[13px] font-bold text-white">
            {isScript ? '请选择源剧本' : '请选择源分镜'}
            <AppIcon name="chevronDown" className="h-3.5 w-3.5 text-[var(--fos-text-4)]" />
          </button>
          <p className="mt-2 text-[12px] text-[var(--fos-text-3)]">可直接选择已有{isScript ? '剧本' : '分镜'}继续转绘。</p>
          <p className="mt-1 flex items-center gap-1 text-[12px] text-[var(--fos-text-4)]">
            <AppIcon name="infoCircle" className="h-3.5 w-3.5" />
            暂无可用{isScript ? '剧本稿' : '分镜稿'}，请先创建「{isScript ? '视频转剧本' : '视频转分镜'}」或选择上传文件模式
          </p>
        </div>
        <div>
          <label className="mb-2 block text-[13px] font-bold text-white">目标市场规则<span className="ml-0.5 text-[#ef4444]">*</span></label>
          <div className="relative">
            <textarea className="fos-textarea" style={{ minHeight: 110 }} maxLength={800}
              placeholder="例如：目标市场：北美；世界观：现代都市豪门；尺度：PG-13，避免血腥与裸露；禁忌：宗教/种族敏感；风格偏好：节奏快、对白短。" />
            <span className="pointer-events-none absolute bottom-2 right-3 text-[12px] text-[var(--fos-text-4)]">0 / 800</span>
          </div>
          <p className="mt-1 text-[12px] text-[var(--fos-text-4)]">简要说明即可，保存前需填写至少 1 个字。</p>
        </div>
      </div>
    </DialogShell>
  )
}
