import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { AdminEmpty, PlatformAdminShell } from '@/components/admin/PlatformAdminShell'
import { authOptions } from '@/lib/auth'

export default async function PlatformAdminMpOpsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await getServerSession(authOptions) as Session | null

  if (!session?.user) redirect(`/${locale}/admin/signin`)
  if (session.user.role !== 'super_admin') redirect(`/${locale}/admin/signin`)

  return (
    <PlatformAdminShell active="mp-ops" eyebrow="平台管理" title="内容运营" description="推荐位、专题、渠道、举报">
      <AdminEmpty>即将开放</AdminEmpty>
    </PlatformAdminShell>
  )
}
