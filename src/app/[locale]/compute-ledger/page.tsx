import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { FosMyLedgerClient } from '@/components/frameos/FosMyLedgerClient'
import { authOptions } from '@/lib/auth'

export default async function MyComputeLedgerPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await getServerSession(authOptions) as Session | null

  if (!session?.user) redirect(`/${locale}/auth/signin`)
  if (session.user.role === 'super_admin') redirect(`/${locale}/admin/accounts`)

  return <FosMyLedgerClient />
}
