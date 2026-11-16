import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { PlatformAdminMpReviewDetailClient } from '@/components/admin/PlatformAdminMpReviewDetailClient'
import { authOptions } from '@/lib/auth'

export default async function PlatformAdminMpReviewDetailPage({
  params,
}: {
  params: Promise<{ locale: string; releaseId: string }>
}) {
  const { locale, releaseId } = await params
  const session = await getServerSession(authOptions) as Session | null

  if (!session?.user) redirect(`/${locale}/admin/signin`)
  if (session.user.role !== 'super_admin') redirect(`/${locale}/admin/signin`)

  return <PlatformAdminMpReviewDetailClient releaseId={decodeURIComponent(releaseId)} />
}
