'use client'

import type { ComponentProps } from 'react'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from './LanguageSwitcher'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'
import UpdateNoticeModal from './UpdateNoticeModal'
import { useGithubReleaseUpdate } from '@/hooks/common/useGithubReleaseUpdate'
import { Link } from '@/i18n/navigation'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'

const AUTH_NAV_LINKS: Array<{ href: ComponentProps<typeof Link>['href']; labelKey: string; icon: AppIconName }> = [
  { href: { pathname: '/projects' }, labelKey: 'workspace', icon: 'monitor' },
  { href: { pathname: '/asset-hub' }, labelKey: 'assetHub', icon: 'folderHeart' },
  { href: { pathname: '/toolbox' }, labelKey: 'toolbox', icon: 'settingsHexMinor' },
  { href: { pathname: '/service-records' }, labelKey: 'serviceRecords', icon: 'receipt' },
  { href: { pathname: '/video-enhance' }, labelKey: 'videoEnhance', icon: 'film' },
  { href: { pathname: '/profile' }, labelKey: 'profile', icon: 'userRoundCog' },
]

export default function Navbar() {
  const { data: session, status } = useSession()
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const { currentVersion, update, shouldPulse, showModal, openModal, dismissCurrentUpdate, checkNow } = useGithubReleaseUpdate()
  const [checkMsg, setCheckMsg] = useState<string | null>(null)
  const [checkMsgFading, setCheckMsgFading] = useState(false)
  const [manualChecking, setManualChecking] = useState(false)

  const handleCheckUpdate = async () => {
    setCheckMsg(null)
    setCheckMsgFading(false)
    setManualChecking(true)
    const minSpin = new Promise(r => setTimeout(r, 1000))
    await Promise.all([checkNow(), minSpin])
    setManualChecking(false)
    setTimeout(() => {
      setCheckMsg('upToDate')
      setTimeout(() => setCheckMsgFading(true), 2000)
      setTimeout(() => { setCheckMsg(null); setCheckMsgFading(false) }, 3000)
    }, 100)
  }

  const renderAuthNavLink = (item: (typeof AUTH_NAV_LINKS)[number], compact = false) => (
    <Link
      key={item.labelKey}
      href={item.href}
      className={
        compact
          ? 'inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm font-medium text-[var(--glass-text-secondary)] transition-colors hover:bg-white/8 hover:text-[var(--glass-text-primary)]'
          : 'inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium text-[var(--glass-text-secondary)] transition-colors hover:bg-white/8 hover:text-[var(--glass-text-primary)]'
      }
    >
      <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
      <span className="whitespace-nowrap">{t(item.labelKey)}</span>
    </Link>
  )

  return (
    <>
      <nav className="glass-nav sticky top-0 z-50">
        <div className="mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Link href={session ? buildAuthenticatedHomeTarget() : { pathname: '/' }} className="group flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2c6ef2] text-sm font-bold text-white shadow-[0_10px_24px_rgba(44,110,242,.24)]">
                  N
                </span>
                <span className="hidden leading-tight sm:block">
                  <span className="block text-sm font-semibold text-[var(--glass-text-primary)]">NoriVideo</span>
                  <span className="block text-[11px] text-[var(--glass-text-tertiary)]">{t('console')}</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={openModal}
                disabled={!update}
                className={`relative inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.02em] transition-all ${update
                  ? 'border-[var(--glass-tone-warning-fg)]/40 bg-[linear-gradient(135deg,var(--glass-tone-warning-bg),var(--glass-bg-surface-strong))] text-[var(--glass-tone-warning-fg)] shadow-[0_8px_24px_-16px_rgba(245,158,11,0.9)] hover:brightness-105'
                  : 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] hover:border-[var(--glass-stroke-focus)] hover:text-[var(--glass-text-primary)] disabled:cursor-default'
                  }`}
                aria-label={tc('updateNotice.openDialog')}
              >
                <span className="inline-flex items-center gap-1.5">
                  <AppIcon name="sparkles" className="h-3.5 w-3.5" />
                  {tc('betaVersion', { version: currentVersion })}
                  {update ? (
                    <span className="relative inline-flex items-center">
                      {shouldPulse ? <span className="absolute -inset-1.5 animate-ping rounded-full bg-[var(--glass-tone-warning-fg)] opacity-20" /> : null}
                      <span className="relative inline-flex items-center gap-1 rounded-full bg-[var(--glass-tone-warning-fg)]/16 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em]">
                        <AppIcon name="upload" className="h-3 w-3" />
                        {tc('updateNotice.updateTag')}
                      </span>
                    </span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleCheckUpdate()}
                disabled={manualChecking}
                className="hidden rounded-full p-1.5 text-[var(--glass-text-tertiary)] transition-colors hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-text-secondary)] disabled:opacity-40 sm:inline-flex"
                title={tc('updateNotice.checkUpdate')}
              >
                <AppIcon name="refresh" className={`h-3.5 w-3.5 ${manualChecking ? 'animate-spin' : ''}`} />
              </button>
              {checkMsg === 'upToDate' && !update && (
                <span
                  className="text-[11px] text-[var(--glass-tone-success-fg)] font-medium transition-opacity duration-1000"
                  style={{ opacity: checkMsgFading ? 0 : 1 }}
                >
                  ✓ {tc('updateNotice.upToDate')}
                </span>
              )}
            </div>
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              {status === 'loading' ? (
                /* Session 加载中骨架屏 */
                <div className="flex items-center gap-3">
                  <div className="h-4 w-16 rounded-full bg-[var(--glass-bg-muted)] animate-pulse" />
                  <div className="h-4 w-16 rounded-full bg-[var(--glass-bg-muted)] animate-pulse" />
                  <div className="h-8 w-20 rounded-lg bg-[var(--glass-bg-muted)] animate-pulse" />
                </div>
              ) : session ? (
                <>
                  <div className="flex min-w-0 items-center gap-1 rounded-md border border-white/10 bg-white/4 p-1">
                    {AUTH_NAV_LINKS.map((item) => renderAuthNavLink(item))}
                  </div>
                  <LanguageSwitcher />
                </>

              ) : (
                <>
                  <Link
                    href={{ pathname: '/auth/signin' }}
                    className="text-sm text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)] font-medium transition-colors"
                  >
                    {t('signin')}
                  </Link>
                  <Link
                    href={{ pathname: '/auth/signup' }}
                    className="glass-btn-base glass-btn-primary px-4 py-2 text-sm font-medium"
                  >
                    {t('signup')}
                  </Link>
                  <LanguageSwitcher />
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:hidden">
              {status === 'loading' ? (
                <div className="h-9 w-9 rounded-lg bg-[var(--glass-bg-muted)] animate-pulse" />
              ) : (
                <LanguageSwitcher compact />
              )}
            </div>
          </div>
          {status !== 'loading' && session ? (
            <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-3 sm:hidden">
              {AUTH_NAV_LINKS.map((item) => renderAuthNavLink(item, true))}
            </nav>
          ) : null}
        </div>
      </nav>
      {update ? (
        <UpdateNoticeModal
          show={showModal}
          currentVersion={currentVersion}
          latestVersion={update.latestVersion}
          releaseUrl={update.releaseUrl}
          releaseName={update.releaseName}
          publishedAt={update.publishedAt}
          onDismiss={dismissCurrentUpdate}
        />
      ) : null}
    </>
  )
}
