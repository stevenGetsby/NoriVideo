import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { AdminEmpty, PlatformAdminShell } from '@/components/admin/PlatformAdminShell'
import { authOptions } from '@/lib/auth'

export default async function PlatformAdminMpStatsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await getServerSession(authOptions) as Session | null

  if (!session?.user) redirect(`/${locale}/admin/signin`)
  if (session.user.role !== 'super_admin') redirect(`/${locale}/admin/signin`)

  return (
    <PlatformAdminShell active="mp-stats" eyebrow="平台管理" title="小程序数据" description="用户、游玩与渠道">
      <AdminEmpty>即将开放</AdminEmpty>
    </PlatformAdminShell>
  )
}
