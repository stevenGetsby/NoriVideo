import { FosStoryboardReviewWorkspace } from '@/components/frameos/FosStoryboardReviewWorkspace'
import { isAssignmentTab, type AssignmentTab } from '@/components/frameos/assignments-view-model'

interface StoryboardReviewPageProps {
  params: Promise<{ locale: string; assignmentId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.find(Boolean) : value
}

export default async function StoryboardReviewPage({ params, searchParams }: StoryboardReviewPageProps) {
  const [{ assignmentId }, query] = await Promise.all([params, searchParams])
  const requestedTab = firstValue(query.from_tab)
  const returnTab: AssignmentTab = isAssignmentTab(requestedTab) ? requestedTab : 'pending_review'
  return <FosStoryboardReviewWorkspace assignmentId={assignmentId} returnTab={returnTab} />
}
