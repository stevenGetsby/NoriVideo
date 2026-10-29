'use client'

import { AppIcon } from '@/components/ui/icons'

interface VoiceDesignDialogProps {
  isOpen: boolean
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave?: (voiceId: string, audioBase64: string) => void
}

/**
 * 旧版 AI 声音设计入口。
 * 服务端 /api/asset-hub/voice-design 已返回 410，这里只保留明确的停用说明，
 * 不再发起任何设计请求。
 */
export default function VoiceDesignDialog({
  isOpen,
  speaker,
  onClose,
}: VoiceDesignDialogProps) {
  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-[9999] glass-overlay" onClick={onClose} />
      <div
        className="fixed z-[10000] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 glass-surface-modal w-full max-w-md p-5"
        role="dialog"
        aria-modal="true"
        aria-label="AI 声音设计已停用"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <AppIcon name="mic" className="h-5 w-5 text-[var(--glass-tone-warning-fg)]" />
          <h2 className="font-semibold text-[var(--glass-text-primary)]">AI 声音设计已停用</h2>
        </div>
        <p className="text-sm leading-6 text-[var(--glass-text-secondary)]">
          为「{speaker}」设计音色的旧版百炼能力已下线，此入口不再可用。请改用参考音频上传；
          已存在的 Kuaizi MiniMax 音色 ID 仍可在画布生成器的音色列表中使用。
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="glass-btn-base glass-btn-primary px-4 py-2 text-sm font-semibold"
          >
            知道了
          </button>
        </div>
      </div>
    </>
  )
}
