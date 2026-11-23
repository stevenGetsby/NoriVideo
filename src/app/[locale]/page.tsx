import type { Metadata } from 'next'
import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { headers } from 'next/headers'
import { redirect } from '@/i18n/navigation'
import { authOptions } from '@/lib/auth'
import { resolveAppSurface, resolveRequestSurface } from '@/lib/app-surface'
import { AUTHENTICATED_HOME_PATHNAME } from '@/lib/home/default-route'
import { LanmiaoHome } from '@/components/home/LanmiaoHome'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return locale === 'en'
    ? { title: 'LanmiaoTV · Stories that leap off the screen', description: 'An AI anime studio for creative teams: script, characters, storyboards and final cut on one infinite canvas.' }
    : { title: 'LanmiaoTV · 让故事跃然屏上', description: '给创作团队的 AI 动漫制作工作台：剧本、角色、分镜到成片，在一块无限画布上完成。' }
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const requestHeaders = await headers()
  const adminSurface = resolveAppSurface() === 'admin' || resolveRequestSurface({
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedPort: requestHeaders.get('x-forwarded-port'),
  }, process.env.ADMIN_PUBLIC_PORT || '8080') === 'admin'
  const session = await getServerSession(authOptions) as Session | null
  if (session?.user || adminSurface) redirect({ href: AUTHENTICATED_HOME_PATHNAME, locale })
  return <LanmiaoHome locale={locale === 'en' ? 'en' : 'zh'} icp={process.env.ICP_NUMBER?.trim() || null} />
}
