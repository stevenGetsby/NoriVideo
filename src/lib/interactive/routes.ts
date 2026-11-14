/** The dedicated editor route for one 影游 chapter 作品. */
export function chapterHref(workId: string, projectId: string, canvasId?: string | null): string {
  const base = `/interactive/${encodeURIComponent(workId)}/chapters/${encodeURIComponent(projectId)}`
  return canvasId ? `${base}/${encodeURIComponent(canvasId)}` : base
}
