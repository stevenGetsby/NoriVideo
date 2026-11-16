import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { PlatformAdminMpReviewClient } from '@/components/admin/PlatformAdminMpReviewClient'
import { authOptions } from '@/lib/auth'

export default async function PlatformAdminMpReviewPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await getServerSession(authOptions) as Session | null

  if (!session?.user) redirect(`/${locale}/admin/signin`)
  if (session.user.role !== 'super_admin') redirect(`/${locale}/admin/signin`)

  return <PlatformAdminMpReviewClient />
}
