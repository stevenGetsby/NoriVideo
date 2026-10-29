import { StoryOverview } from '@/features/interactive/StoryOverview'

interface StoryOverviewPageProps {
  params: Promise<{ locale: string; workId: string }>
}

export default async function StoryOverviewPage({ params }: StoryOverviewPageProps) {
  const { workId } = await params
  return <StoryOverview workId={decodeURIComponent(workId)} />
}
