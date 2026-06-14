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
          ? `inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm transition-colors ${
            active
              ? 'border-[#2c6ef2]/70 bg-[#2c6ef2] text-white shadow-[0_10px_24px_rgba(44,110,242,.24)]'
              : 'border-white/10 bg-white/5 text-white/68 hover:bg-white/8 hover:text-white'
          }`
          : `flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
            active
              ? 'bg-[#2c6ef2] text-white shadow-[0_10px_24px_rgba(44,110,242,.24)]'
              : 'text-white/68 hover:bg-white/7 hover:text-white'
          }`
      }
    >
      <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="rounded bg-[#ff3b30]/18 px-1.5 py-0.5 text-[10px] font-bold text-[#ff7b72]">
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
    <div className="glass-page min-h-screen bg-[#0f0f12]">
      <Navbar />

      <div className="mx-auto flex max-w-[1680px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="sticky top-24 hidden h-[calc(100vh-7rem)] w-64 shrink-0 flex-col rounded-lg border border-white/10 bg-[#15161b] p-4 shadow-[0_18px_50px_rgba(0,0,0,.22)] lg:flex">
          <Link href={{ pathname: '/projects' }} className="mb-5 flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2c6ef2] text-sm font-bold text-white">
              N
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">NoriVideo</div>
              <div className="text-xs text-white/45">{t('sidebarSubtitle')}</div>
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

          <div className="mt-auto border-t border-white/10 pt-4">
            <Link
              href={{ pathname: '/service-records' }}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                activeKey === 'serviceRecords'
                  ? 'bg-white/10 text-white'
                  : 'text-white/62 hover:bg-white/7 hover:text-white'
              }`}
            >
              <AppIcon name="receipt" className="h-4 w-4" />
              {t('nav.serviceRecords')}
            </Link>
            <Link
              href={{ pathname: '/feedback' }}
              className={`mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                activeKey === 'feedback'
                  ? 'bg-white/10 text-white'
                  : 'text-white/62 hover:bg-white/7 hover:text-white'
              }`}
            >
              <AppIcon name="infoCircle" className="h-4 w-4" />
              {t('nav.feedback')}
            </Link>
            <Link
              href={{ pathname: '/updates' }}
              className={`mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                activeKey === 'updates'
                  ? 'bg-white/10 text-white'
                  : 'text-white/62 hover:bg-white/7 hover:text-white'
              }`}
            >
              <AppIcon name="arrowDownCircle" className="h-4 w-4" />
              {t('nav.updates')}
            </Link>
            <button className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-white/62 hover:bg-white/7 hover:text-white">
              <AppIcon name="userRoundCog" className="h-4 w-4" />
              {session?.user?.name || session?.user?.email || t('nav.user')}
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-4 rounded-lg border border-white/10 bg-[#15161b] p-3 shadow-[0_14px_34px_rgba(0,0,0,.18)] lg:hidden">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Link href={{ pathname: '/projects' }} className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2c6ef2] text-sm font-bold text-white">
                  N
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">NoriVideo</div>
                  <div className="truncate text-xs text-white/45">{t('sidebarSubtitle')}</div>
                </div>
              </Link>
              <div className="truncate text-xs text-white/38">
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
