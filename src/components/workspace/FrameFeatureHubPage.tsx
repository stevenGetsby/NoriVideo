'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'
import { FrameWorkbenchShell, type FrameWorkbenchNavKey } from '@/components/workspace/FrameWorkbenchShell'

interface FeatureCard {
  title: string
  description: string
  meta: string
  icon: AppIconName
}

interface FrameFeatureHubPageProps {
  activeKey: FrameWorkbenchNavKey
  pageKey: string
  icon: AppIconName
  children?: React.ReactNode
}

export function FrameFeatureHubPage({ activeKey, pageKey, icon, children }: FrameFeatureHubPageProps) {
  const t = useTranslations('workspace.hubPages')
  const cards = t.raw(`${pageKey}.cards`) as FeatureCard[]

  return (
    <FrameWorkbenchShell activeKey={activeKey}>
      <section className="mb-6 rounded-lg border border-white/10 bg-[#171922] p-5 shadow-[0_18px_50px_rgba(0,0,0,.20)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/62">
              <AppIcon name={icon} className="h-3.5 w-3.5" />
              {t(`${pageKey}.eyebrow`)}
            </div>
            <h1 className="text-2xl font-bold text-white md:text-3xl">{t(`${pageKey}.title`)}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">{t(`${pageKey}.subtitle`)}</p>
          </div>
          <Link
            href={{ pathname: '/workspace' }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1f5edd]"
          >
            <AppIcon name="plus" className="h-4 w-4" />
            {t('common.createProject')}
          </Link>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <article
              key={card.title}
              className="rounded-lg border border-white/10 bg-[#151820] p-4 transition-colors hover:border-[#2c6ef2]/55 hover:bg-[#181d28]"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 text-[#7eb0ff]">
                  <AppIcon name={card.icon} className="h-5 w-5" />
                </div>
                <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/45">
                  {card.meta}
                </span>
              </div>
              <h2 className="text-base font-semibold text-white">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/52">{card.description}</p>
            </article>
          ))}
        </div>

        <aside className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#7eb0ff]" />
            {t('common.workflowTitle')}
          </div>
          <div className="space-y-3">
            {['script', 'assets', 'storyboard', 'shots', 'delivery'].map((step, index) => (
              <div key={step} className="flex items-center gap-3 rounded-md border border-white/10 bg-white/4 px-3 py-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded bg-[#2c6ef2]/16 text-xs font-bold text-[#8ab8ff]">
                  {index + 1}
                </div>
                <div>
                  <div className="text-sm font-medium text-white/72">{t(`common.steps.${step}`)}</div>
                  <div className="text-xs text-white/34">{t('common.ready')}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      {children ? <section className="mt-5">{children}</section> : null}
    </FrameWorkbenchShell>
  )
}
