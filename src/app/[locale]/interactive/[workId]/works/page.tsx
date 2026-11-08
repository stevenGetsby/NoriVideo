import { StoryWorksCanvas } from '@/features/interactive/StoryWorksCanvas'

interface StoryWorksPageProps {
  params: Promise<{ locale: string; workId: string }>
}

export default async function StoryWorksPage({ params }: StoryWorksPageProps) {
  const { workId } = await params
  return <StoryWorksCanvas workId={decodeURIComponent(workId)} />
}
