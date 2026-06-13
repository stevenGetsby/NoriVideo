'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { countWords } from '@/lib/word-count'
import type { EpisodeMarkerResult } from '@/lib/episode-marker-detector'
import { AppIcon } from '@/components/ui/icons'

interface StepSourceProps {
  onManualCreate: (rawContent?: string) => void
  rawContent: string
  onRawContentChange: (content: string) => void
  onAnalyze: () => void
  error: string | null
  showMarkerConfirm: boolean
  markerResult: EpisodeMarkerResult | null
  onCloseMarkerConfirm: () => void
  onUseMarkerSplit: () => void
  onUseAiSplit: () => void
}

export default function StepSource({
  onManualCreate,
  rawContent,
  onRawContentChange,
  onAnalyze,
  error,
  showMarkerConfirm,
  markerResult,
  onCloseMarkerConfirm,
  onUseMarkerSplit,
  onUseAiSplit,
}: StepSourceProps) {
  const t = useTranslations('smartImport')

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center bg-[#ECF1F4] p-4 sm:p-8">
      {showMarkerConfirm && markerResult && (
        <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50" onClick={onCloseMarkerConfirm}>
          <div className="glass-surface-modal p-6 w-full max-w-lg animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-[var(--glass-tone-info-bg)] rounded-full flex items-center justify-center mx-auto mb-4">
                <AppIcon name="fileText" className="w-7 h-7 text-[var(--glass-tone-info-fg)]" />
              </div>
              <h3 className="text-xl font-bold text-[var(--glass-text-primary)] mb-2">{t('markerDetected.title')}</h3>
              <p className="text-[var(--glass-text-secondary)]">
                {t('markerDetected.description', {
                  count: markerResult.matches.length,
                  type: t(`markerDetected.markerTypes.${markerResult.markerTypeKey}` as 'numbered' | 'chapter' | 'custom'),
                })}
              </p>
            </div>

            <div className="mb-6">
              <p className="text-sm font-medium text-[var(--glass-text-tertiary)] mb-3">{t('markerDetected.preview')}</p>
              <div className="bg-[var(--glass-bg-muted)] rounded-xl p-4 max-h-64 overflow-y-auto space-y-2">
                {markerResult.previewSplits.map((split, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-sm">
                    <span className="flex-shrink-0 w-16 font-medium text-[var(--glass-tone-info-fg)]">
                      {t('episode', { num: split.number })}
                    </span>
                    <span className="text-[var(--glass-text-secondary)] truncate flex-1">
                      {split.preview || split.title}
                    </span>
                    <span className="flex-shrink-0 text-[var(--glass-text-tertiary)] text-xs">
                      ~{split.wordCount.toLocaleString()}{t('upload.words')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <button
                onClick={onUseMarkerSplit}
                className="glass-btn-base glass-btn-primary py-4 px-3 rounded-xl font-bold transition-all flex flex-col items-center gap-1"
              >
                <span>{t('markerDetected.useMarker')}</span>
                <span className="text-xs font-normal opacity-80">{t('markerDetected.useMarkerDesc')}</span>
              </button>
              <button
                onClick={onUseAiSplit}
                className="py-4 bg-[var(--glass-bg-surface)] border-2 border-[var(--glass-stroke-base)] text-[var(--glass-text-secondary)] rounded-xl font-bold hover:border-[var(--glass-stroke-focus)] hover:bg-[var(--glass-tone-info-bg)] transition-all flex flex-col items-center gap-1"
              >
                <span>{t('markerDetected.useAI')}</span>
                <span className="text-xs font-normal text-[var(--glass-text-tertiary)]">{t('markerDetected.useAIDesc')}</span>
              </button>
            </div>

            <button
              onClick={onCloseMarkerConfirm}
              className="w-full py-2.5 text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-secondary)] font-medium transition-colors"
            >
              {t('markerDetected.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-5xl">
        <div className="relative mb-8 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[rgba(14,14,44,.08)] bg-white/85 px-3 py-2 shadow-[0_1px_2px_rgba(14,14,44,.04)]">
            <Image
              src="/nori-view/nori-onion-logo.png"
              alt="Nori"
              width={28}
              height={28}
              className="h-7 w-7 rounded-lg object-contain"
            />
            <span className="text-sm font-semibold text-[#0e0e2c]">Nori Workflow</span>
          </div>
          <h1 className="mb-4 text-4xl font-extrabold text-[#0e0e2c] md:text-5xl">
            {t('title')}
          </h1>
          <p className="mx-auto max-w-2xl text-base font-medium leading-relaxed text-[#4d5665] md:text-lg">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid items-stretch gap-5 md:grid-cols-2">
          <button
            onClick={() => onManualCreate(rawContent)}
            className="group relative flex min-h-[248px] cursor-pointer flex-col justify-center overflow-hidden rounded-xl border border-[rgba(14,14,44,.09)] bg-white p-7 text-left shadow-[0_12px_28px_rgba(14,14,44,.07)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(14,14,44,.18)] hover:shadow-[0_18px_34px_rgba(14,14,44,.1)]"
          >
            <Image
              src="/nori-view/onion-burst-ring.png"
              alt=""
              width={220}
              height={220}
              className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 object-contain opacity-35 transition-transform duration-300 group-hover:scale-105"
            />
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg bg-[#ECF1F4] transition-colors duration-200 group-hover:bg-[#D6FF00]/50">
              <AppIcon name="edit" className="h-7 w-7 text-[#0e0e2c]" />
            </div>
            <h3 className="mb-3 text-2xl font-bold text-[#0e0e2c]">{t('manualCreate.title')}</h3>
            <p className="mb-6 max-w-[28rem] leading-relaxed text-[#5f6876]">{t('manualCreate.description')}</p>
            <div className="flex items-center font-bold text-[#0e0e2c]">
              <span>{t('manualCreate.button')}</span>
              <AppIcon name="chevronRight" className="ml-2 h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />
            </div>
          </button>

          <div className="relative flex flex-col rounded-xl border border-[rgba(14,14,44,.09)] bg-white p-6 shadow-[0_12px_28px_rgba(14,14,44,.07)]">
            <Image
              src="/nori-view/nori-ip-character.png"
              alt=""
              width={180}
              height={204}
              className="pointer-events-none absolute -bottom-8 right-1 h-52 w-auto object-contain opacity-20"
            />
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#D6FF00]">
                <AppIcon name="bolt" className="h-6 w-6 text-[#0e0e2c]" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-[#0e0e2c]">{t('smartImport.title')}</h3>
                <p className="text-sm text-[#5f6876]">{t('smartImport.description')}</p>
              </div>
            </div>

            <div className="relative z-10 flex flex-grow flex-col">
              <textarea
                value={rawContent}
                onChange={(e) => onRawContentChange(e.target.value)}
                className="min-h-[180px] w-full flex-grow resize-none rounded-lg border border-[rgba(14,14,44,.1)] bg-[#f7fafc] p-4 text-sm leading-relaxed text-[#0e0e2c] outline-none transition-colors placeholder:text-[#7c8491] focus:border-[rgba(14,14,44,.26)] focus:bg-white"
                placeholder={t('upload.placeholder')}
              />

              <div className="mt-4 flex items-center justify-between gap-6">
                <span className="whitespace-nowrap text-sm text-[#7c8491]">
                  {countWords(rawContent).toLocaleString()} {t('upload.words')} / 30,000
                </span>
                <button
                  onClick={onAnalyze}
                  disabled={!rawContent.trim() || rawContent.length < 100}
                  className="glass-btn-base glass-btn-primary flex items-center gap-2 whitespace-nowrap rounded-lg px-5 py-2 font-bold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{t('upload.startAnalysis')}</span>
                  <AppIcon name="arrowRightWide" className="h-4 w-4" />
                </button>
              </div>
            </div>

            {error && (
              <div className="relative z-10 mt-4 rounded-lg border border-[var(--glass-stroke-danger)] bg-[var(--glass-tone-danger-bg)] p-3 text-sm text-[var(--glass-tone-danger-fg)]">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
