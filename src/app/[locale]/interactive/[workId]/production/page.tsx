import { StoryProductionCanvas } from '@/features/interactive/StoryProductionCanvas'

interface StoryProductionPageProps {
  params: Promise<{ locale: string; workId: string }>
}

export default async function StoryProductionPage({ params }: StoryProductionPageProps) {
  const { workId } = await params
  return <StoryProductionCanvas workId={decodeURIComponent(workId)} />
}
