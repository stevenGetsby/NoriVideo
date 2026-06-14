'use client'

import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'

export type FrameWorkbenchNavKey =
  | 'projects'
  | 'writerWorkbench'
  | 'toolbox'
  | 'seedance'
  | 'assetHub'
  | 'materialLibrary'
  | 'prompts'
  | 'team'
  | 'serviceRecords'
  | 'feedback'
  | 'updates'

interface FrameWorkbenchShellProps {
  activeKey: FrameWorkbenchNavKey
  children: React.ReactNode
}

interface FrameNavItem {
  key: FrameWorkbenchNavKey
  label: string
  icon: AppIconName
  href: string
  badge?: string
}

function FrameNavLink({
  item,
  active,
  compact = false,
}: {
  item: FrameNavItem
  active: boolean
  compact?: boolean
}) {
  return (
    <Link
      href={{ pathname: item.href }}
      className={
        compact
          ? `inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors ${
            active
              ? 'border-[var(--fos-primary-interactive)] bg-[var(--fos-primary-interactive)] text-white shadow-[var(--fos-shadow-btn-glow)]'
              : 'border-[var(--fos-border-lighter)] bg-[var(--fos-bg-4)] text-[var(--fos-text-secondary)] hover:bg-[var(--fos-bg-5)] hover:text-[var(--fos-text-title)]'
          }`
          : `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${
            active
              ? 'bg-[var(--fos-primary-interactive)] text-white shadow-[var(--fos-shadow-btn-glow)]'
              : 'text-[var(--fos-text-secondary)] hover:bg-[var(--fos-bg-5)] hover:text-[var(--fos-text-title)]'
          }`
      }
    >
      <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="rounded bg-[var(--fos-danger)]/18 px-1.5 py-0.5 text-[10px] font-bold text-[var(--fos-danger-light)]">
          {item.badge}
        </span>
      ) : null}
    </Link>
  )
}

export function FrameWorkbenchShell({ activeKey, children }: FrameWorkbenchShellProps) {
  const { data: session } = useSession()
  const t = useTranslations('workspace')

  const navItems: FrameNavItem[] = [
    { key: 'projects', label: t('nav.projects'), icon: 'monitor', href: '/projects' },
    { key: 'writerWorkbench', label: t('nav.writerWorkbench'), icon: 'fileText', href: '/writer-workbench' },
    { key: 'toolbox', label: t('nav.toolbox'), icon: 'settingsHexMinor', href: '/toolbox' },
    { key: 'seedance', label: t('nav.seedance'), icon: 'film', href: '/seedance', badge: 'HOT' },
    { key: 'assetHub', label: t('nav.assetHub'), icon: 'folderHeart', href: '/asset-hub' },
    { key: 'materialLibrary', label: t('nav.materialLibrary'), icon: 'package', href: '/material' },
    { key: 'prompts', label: t('nav.prompts'), icon: 'bookmark', href: '/prompts' },
    { key: 'team', label: t('nav.team'), icon: 'userRoundCog', href: '/team' },
  ]

  return (
    <div data-theme="frameos-dark" className="min-h-screen bg-[var(--fos-bg-1)]">
      <Navbar />

      <div className="mx-auto flex max-w-[1680px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="sticky top-24 hidden h-[calc(100vh-7rem)] w-64 shrink-0 flex-col rounded-[10px] border border-[var(--fos-border-lighter)] bg-[var(--fos-bg-2)] p-4 shadow-[var(--fos-shadow-inset-hi)] lg:flex">
          <Link href={{ pathname: '/projects' }} className="mb-5 flex items-center gap-3 border-b border-[var(--fos-border-lighter)] pb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--fos-primary-interactive)] text-sm font-bold text-white">
              N
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[var(--fos-text-title)]">NoriVideo</div>
              <div className="text-xs text-[var(--fos-text-tertiary)]">{t('sidebarSubtitle')}</div>
            </div>
          </Link>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = item.key === activeKey
              return (
                <FrameNavLink key={item.key} item={item} active={active} />
              )
            })}
          </nav>

          <div className="mt-auto border-t border-[var(--fos-border-lighter)] pt-4">
            <Link
              href={{ pathname: '/service-records' }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${
                activeKey === 'serviceRecords'
                  ? 'bg-[var(--fos-bg-5)] text-[var(--fos-text-title)]'
                  : 'text-[var(--fos-text-secondary)] hover:bg-[var(--fos-bg-5)] hover:text-[var(--fos-text-title)]'
              }`}
            >
              <AppIcon name="receipt" className="h-4 w-4" />
              {t('nav.serviceRecords')}
            </Link>
            <Link
              href={{ pathname: '/feedback' }}
              className={`mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${
                activeKey === 'feedback'
                  ? 'bg-[var(--fos-bg-5)] text-[var(--fos-text-title)]'
                  : 'text-[var(--fos-text-secondary)] hover:bg-[var(--fos-bg-5)] hover:text-[var(--fos-text-title)]'
              }`}
            >
              <AppIcon name="infoCircle" className="h-4 w-4" />
              {t('nav.feedback')}
            </Link>
            <Link
              href={{ pathname: '/updates' }}
              className={`mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${
                activeKey === 'updates'
                  ? 'bg-[var(--fos-bg-5)] text-[var(--fos-text-title)]'
                  : 'text-[var(--fos-text-secondary)] hover:bg-[var(--fos-bg-5)] hover:text-[var(--fos-text-title)]'
              }`}
            >
              <AppIcon name="arrowDownCircle" className="h-4 w-4" />
              {t('nav.updates')}
            </Link>
            <button className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-[var(--fos-text-secondary)] hover:bg-[var(--fos-bg-5)] hover:text-[var(--fos-text-title)]">
              <AppIcon name="userRoundCog" className="h-4 w-4" />
              {session?.user?.name || session?.user?.email || t('nav.user')}
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-4 rounded-[10px] border border-[var(--fos-border-lighter)] bg-[var(--fos-bg-2)] p-3 shadow-[var(--fos-shadow-inset-hi)] lg:hidden">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Link href={{ pathname: '/projects' }} className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--fos-primary-interactive)] text-sm font-bold text-white">
                  N
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[var(--fos-text-title)]">NoriVideo</div>
                  <div className="truncate text-xs text-[var(--fos-text-tertiary)]">{t('sidebarSubtitle')}</div>
                </div>
              </Link>
              <div className="truncate text-xs text-[var(--fos-text-tertiary)]">
                {session?.user?.name || session?.user?.email || t('nav.user')}
              </div>
            </div>
            <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {navItems.map((item) => (
                <FrameNavLink key={item.key} item={item} active={item.key === activeKey} compact />
              ))}
            </nav>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { key: 'serviceRecords' as const, label: t('nav.serviceRecords'), icon: 'receipt' as AppIconName, href: '/service-records' },
                { key: 'feedback' as const, label: t('nav.feedback'), icon: 'infoCircle' as AppIconName, href: '/feedback' },
                { key: 'updates' as const, label: t('nav.updates'), icon: 'arrowDownCircle' as AppIconName, href: '/updates' },
              ].map((item) => (
                <FrameNavLink key={item.key} item={item} active={item.key === activeKey} compact />
              ))}
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
