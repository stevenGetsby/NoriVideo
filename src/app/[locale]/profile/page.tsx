'use client'
import type { ComponentProps } from 'react'
import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import Navbar from '@/components/Navbar'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'
import { Link, useRouter } from '@/i18n/navigation'

const ApiConfigTab = dynamic(() => import('./components/ApiConfigTab'), {
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--glass-text-tertiary)] border-t-transparent" />
    </div>
  ),
})

export default function ProfilePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const t = useTranslations('profile')
  const tc = useTranslations('common')

  useEffect(() => {
    if (status === 'loading') return
    if (!session) { router.push({ pathname: '/auth/signin' }); return }
  }, [router, session, status])

  if (status === 'loading' || !session) {
    return (
      <div className="glass-page flex min-h-screen items-center justify-center">
        <div className="text-[var(--glass-text-secondary)]">{tc('loading')}</div>
      </div>
    )
  }

  const quickLinks: Array<{ key: string; href: ComponentProps<typeof Link>['href']; icon: AppIconName; label: string; detail: string }> = [
    { key: 'projects', href: { pathname: '/projects' }, icon: 'monitor', label: t('quickLinks.projects'), detail: t('quickLinks.projectsHint') },
    { key: 'assetHub', href: { pathname: '/asset-hub' }, icon: 'folderHeart', label: t('quickLinks.assetHub'), detail: t('quickLinks.assetHubHint') },
    { key: 'records', href: { pathname: '/service-records' }, icon: 'receipt', label: t('quickLinks.records'), detail: t('quickLinks.recordsHint') },
  ]

  return (
    <div className="glass-page min-h-screen bg-[#0f0f12]">
      <Navbar />

      <main className="mx-auto max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <aside className="rounded-lg border border-white/10 bg-[#15161b] p-4 shadow-[0_18px_50px_rgba(0,0,0,.22)]">
            <div className="mb-5 flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#2c6ef2] text-sm font-bold text-white">
                {(session.user?.name || session.user?.email || 'N').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-white">{session.user?.name || t('user')}</h2>
                <p className="truncate text-xs text-white/45">{session.user?.email || t('personalAccount')}</p>
              </div>
            </div>

            <div className="mb-5 rounded-md border border-white/10 bg-white/4 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                <AppIcon name="userRoundCog" className="h-4 w-4 text-[#7eb0ff]" />
                {t('settingsTitle')}
              </div>
              <div className="mt-2 text-xs leading-5 text-white/42">{t('settingsSubtitle')}</div>
            </div>

            <nav className="space-y-2">
              <div className="flex w-full items-center gap-3 rounded-md bg-[#2c6ef2] px-3 py-2.5 text-left text-sm font-medium text-white shadow-[0_10px_24px_rgba(44,110,242,.24)]">
                <AppIcon name="settingsHexAlt" className="h-4 w-4" />
                {t('apiConfig')}
              </div>
              {quickLinks.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex items-start gap-3 rounded-md border border-white/10 bg-white/4 px-3 py-2.5 transition-colors hover:bg-white/8"
                >
                  <AppIcon name={item.icon} className="mt-0.5 h-4 w-4 shrink-0 text-[#7eb0ff]" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white/72">{item.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-white/36">{item.detail}</span>
                  </span>
                </Link>
              ))}
            </nav>

            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2.5 text-sm font-semibold text-[#ffb1b1] transition-colors hover:bg-[#ff6b6b]/14"
            >
              <AppIcon name="logout" className="h-4 w-4" />
              {t('logout')}
            </button>
          </aside>

          <section className="min-w-0 rounded-lg border border-white/10 bg-[#15161b] shadow-[0_18px_50px_rgba(0,0,0,.22)]">
            <div className="border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <AppIcon name="settingsHexAlt" className="h-4 w-4 text-[#7eb0ff]" />
                {t('apiConfig')}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/45">{t('apiConfigHint')}</p>
            </div>
            <div className="h-[calc(100vh-220px)] min-h-[620px] overflow-auto p-4">
              <ApiConfigTab />
            </div>
          </section>
        </div>
      </main >
    </div >
  )
}
