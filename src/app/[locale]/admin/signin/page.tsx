import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { PlatformAdminSignInClient } from '@/components/admin/PlatformAdminSignInClient'
import { authOptions } from '@/lib/auth'

export default async function PlatformAdminSignInPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await getServerSession(authOptions) as Session | null
  if (session?.user?.role === 'super_admin') redirect(`/${locale}/admin/accounts`)
  const workspaceBase = process.env.PUBLIC_APP_URL || 'http://localhost:3000'
  const workspaceSignInUrl = new URL(`/${locale}/auth/signin`, workspaceBase).toString()
  return <PlatformAdminSignInClient workspaceSignInUrl={workspaceSignInUrl} />
}
