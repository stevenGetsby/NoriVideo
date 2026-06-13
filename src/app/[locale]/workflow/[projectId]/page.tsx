import { redirect } from 'next/navigation'

interface WorkflowProjectPageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams: Promise<{ stage?: string; episode?: string; focus?: string }>
}

export default async function WorkflowProjectPage({ params, searchParams }: WorkflowProjectPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  const targetParams = new URLSearchParams()

  if (resolvedSearchParams.stage) targetParams.set('stage', resolvedSearchParams.stage)
  if (resolvedSearchParams.episode) targetParams.set('episode', resolvedSearchParams.episode)
  if (resolvedSearchParams.focus) targetParams.set('focus', resolvedSearchParams.focus)

  const query = targetParams.toString()
  redirect(`/${resolvedParams.locale}/workspace/${resolvedParams.projectId}${query ? `?${query}` : ''}`)
}
