import type { ReactNode } from 'react'
import type { VoiceCreationRuntime } from './hooks/useVoiceCreation'
import { AppIcon } from '@/components/ui/icons'

interface VoiceCreationFormProps {
  runtime: VoiceCreationRuntime
  children: ReactNode
}

export default function VoiceCreationForm({ runtime, children }: VoiceCreationFormProps) {
  const {
    voiceName,
    tHub,
    tvCreate,
    setVoiceName,
    handleClose,
  } = runtime

  return (
    <div
      className="fixed z-[10000] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 glass-surface-modal w-full max-w-xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)]">
        <div className="flex items-center gap-2">
          <AppIcon name="mic" className="w-5 h-5 text-[var(--glass-tone-info-fg)]" />
          <h2 className="font-semibold text-[var(--glass-text-primary)]">{tHub('addVoice')}</h2>
        </div>
        <button onClick={handleClose} className="glass-btn-base glass-btn-soft p-1 text-[var(--glass-text-tertiary)]">
          <AppIcon name="close" className="w-5 h-5" />
        </button>
      </div>

      <div className="px-5 pt-4">
        <div className="rounded-lg border border-[var(--glass-tone-warning-fg)]/25 bg-[var(--glass-tone-warning-bg)] px-3 py-2 text-xs leading-5 text-[var(--glass-tone-warning-fg)]">
          {tvCreate('aiDesignRetired')}
        </div>
      </div>

      <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        <div>
          <label className="glass-field-label mb-1 block">{tHub('voiceName')}</label>
          <input
            type="text"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            placeholder={tHub('voiceNamePlaceholder')}
            className="glass-input-base w-full px-3 py-2 text-sm"
          />
        </div>

        {children}
      </div>
    </div>
  )
}
