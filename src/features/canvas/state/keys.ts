export const canvasQueryKeys = {
  all: ['canvas'] as const,
  list: (projectId: string) => ['canvas', 'list', projectId] as const,
  detail: (projectId: string, canvasId: string) => ['canvas', 'detail', projectId, canvasId] as const,
}
