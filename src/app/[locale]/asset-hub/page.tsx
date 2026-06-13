import { redirect } from 'next/navigation'

interface AssetHubAliasPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AssetHubAliasPage({ params, searchParams }: AssetHubAliasPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  const targetParams = new URLSearchParams()

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => targetParams.append(key, item))
    } else if (typeof value === 'string') {
      targetParams.set(key, value)
    }
  }

  const query = targetParams.toString()
  redirect(`/${resolvedParams.locale}/workspace/asset-hub${query ? `?${query}` : ''}`)
}
