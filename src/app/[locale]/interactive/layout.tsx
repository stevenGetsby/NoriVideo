import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'

export default async function InteractiveLayout({ children, params }: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) redirect(`/${locale}/auth/signin`)
  if (auth.session.user.contentRestrictions?.includes('story-canvas')) notFound()
  return children
}
