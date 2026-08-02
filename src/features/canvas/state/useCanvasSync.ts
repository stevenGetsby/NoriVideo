'use client'

import { useQuery } from '@tanstack/react-query'
import { canvasApi } from '../api/client'
import { canvasQueryKeys } from './keys'
import type { CanvasGraphResponse } from '../types'

export function useCanvasGraph(projectId: string, canvasId: string) {
  return useQuery<CanvasGraphResponse>({
    queryKey: canvasQueryKeys.detail(projectId, canvasId),
    queryFn: () => canvasApi.get(projectId, canvasId),
    staleTime: 30_000,
  })
}
