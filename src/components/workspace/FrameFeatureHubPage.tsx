'use client'

import type { ComponentProps, CSSProperties, ReactNode } from 'react'
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

interface HubPrimaryAction {
  href: ComponentProps<typeof Link>['href']
  labelKey: string
  icon: AppIconName
}

interface FrameFeatureHubPageProps {
  activeKey: FrameWorkbenchNavKey
  pageKey: string
  icon: AppIconName
  primaryAction?: HubPrimaryAction | null
  children?: ReactNode
}

const CARD_HUES = ['#5b9dff', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#fb923c', '#2dd4bf']
const STEP_HUES: Record<string, string> = { script: '#fbbf24', assets: '#fb923c', storyboard: '#5b9dff', shots: '#a78bfa', delivery: '#34d399' }
const hueStyle = (hue: string) => ({ '--hue': hue }) as CSSProperties

export function FrameFeatureHubPage({ activeKey, pageKey, icon, primaryAction, children }: FrameFeatureHubPageProps) {
  const t = useTranslations('workspace.hubPages')
  const cards = t.raw(`${pageKey}.cards`) as FeatureCard[]
  const action = primaryAction === undefined
    ? { href: { pathname: '/workspace' }, labelKey: 'createProject', icon: 'plus' as AppIconName }
    : primaryAction

  return (
    <FrameWorkbenchShell activeKey={activeKey}>
      <section className="fos-hero mb-5 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="fos-hero-tile">
              <AppIcon name={icon} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-[var(--fos-primary-text)]">{t(`${pageKey}.eyebrow`)}</div>
              <h1 className="mt-1 truncate text-xl font-bold text-white md:text-2xl">{t(`${pageKey}.title`)}</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-white/52">{t(`${pageKey}.subtitle`)}</p>
            </div>
          </div>
          {action ? (
            <Link
              href={action.href}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[linear-gradient(100deg,#3c8bff_0%,#6c5cff_52%,#a855f7_100%)] px-3 text-sm font-semibold text-white shadow-[var(--fos-cta-shadow)] transition-colors hover:brightness-110"
            >
              <AppIcon name={action.icon} className="h-4 w-4" />
              {t(`common.${action.labelKey}`)}
            </Link>
          ) : null}
        </div>
      </section>

      {children ? <section>{children}</section> : null}

      <section className="mt-5 grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((card, cardIndex) => (
            <article
              key={card.title}
              style={hueStyle(CARD_HUES[cardIndex % CARD_HUES.length])}
              className="fos-hue-card rounded-xl border border-white/10 bg-[#16161d] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="fos-hue-tile">
                  <AppIcon name={card.icon} className="h-4 w-4" />
                </span>
                <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/45">
                  {card.meta}
                </span>
              </div>
              <h2 className="truncate text-sm font-semibold text-white/78">{card.title}</h2>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{card.description}</p>
            </article>
          ))}
        </div>

        <aside className="rounded-md border border-white/10 bg-[#16161d] p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/78">
            <AppIcon name="clipboardCheck" className="h-4 w-4 text-[var(--fos-primary-text)]" />
            {t('common.workflowTitle')}
          </div>
          <div className="space-y-2">
            {['script', 'assets', 'storyboard', 'shots', 'delivery'].map((step, index) => (
              <div key={step} style={hueStyle(STEP_HUES[step])} className="flex items-center gap-3 rounded-md border border-white/10 bg-white/4 px-3 py-2">
                <div className="fos-hue-tile fos-hue-tile-sm">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white/72">{t(`common.steps.${step}`)}</div>
                  <div className="text-xs text-white/34">{t('common.ready')}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </FrameWorkbenchShell>
  )
}
