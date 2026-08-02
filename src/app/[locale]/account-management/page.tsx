import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { FosAccountManagementClient } from '@/components/frameos/FosAccountManagementClient'
import { authOptions } from '@/lib/auth'

export default async function AccountManagementPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await getServerSession(authOptions) as Session | null

  if (!session?.user) redirect(`/${locale}/auth/signin`)
  if (session.user.role === 'super_admin') redirect(`/${locale}/admin/accounts`)
  if (session.user.role !== 'admin') redirect(`/${locale}/projects`)

  return <FosAccountManagementClient />
}
