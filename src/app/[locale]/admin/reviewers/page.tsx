import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { PlatformAdminReviewersClient } from '@/components/admin/PlatformAdminReviewersClient'
import { authOptions } from '@/lib/auth'

export default async function PlatformAdminReviewersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await getServerSession(authOptions) as Session | null
  if (!session?.user || session.user.role !== 'super_admin') redirect(`/${locale}/admin/signin`)
  return <PlatformAdminReviewersClient />
}
