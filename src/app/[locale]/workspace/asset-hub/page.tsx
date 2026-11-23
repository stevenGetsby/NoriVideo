import { FosAssetHubClient } from '@/components/frameos/FosAssetHubClient'
import { notFound, redirect } from 'next/navigation'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'

export default async function AssetHubPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) redirect(`/${locale}/auth/signin`)
  if (auth.session.user.contentRestrictions?.includes('asset-library')) notFound()
  return <FosAssetHubClient />
}
