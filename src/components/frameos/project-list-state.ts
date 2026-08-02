export type ProjectListViewState = 'loading' | 'error' | 'populated' | 'empty'

export function resolveProjectListViewState({
  loading,
  error,
  projectCount,
}: {
  loading: boolean
  error: string | null
  projectCount: number
}): ProjectListViewState {
  if (loading) return 'loading'
  if (error) return 'error'
  if (projectCount > 0) return 'populated'
  return 'empty'
}
