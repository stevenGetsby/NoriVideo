'use client'

import { useQuery } from '@tanstack/react-query'
import { canvasApi } from '../api/client'
import { canvasQueryKeys } from './keys'
import type { CanvasGraphResponse } from '../types'

export function useCanvasGraph(projectId: string, canvasId: string, lightGraph = false) {
  return useQuery<CanvasGraphResponse>({
    queryKey: [...canvasQueryKeys.detail(projectId, canvasId), lightGraph ? 'summary-v1' : 'full'] as const,
    queryFn: () => lightGraph ? canvasApi.getSummary(projectId, canvasId) : canvasApi.get(projectId, canvasId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}
