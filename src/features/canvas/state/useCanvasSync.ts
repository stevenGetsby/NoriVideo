'use client'

import { useQuery } from '@tanstack/react-query'
import { canvasApi } from '../api/client'
import { canvasQueryKeys } from './keys'
import type { CanvasGraphResponse } from '../types'

export function useCanvasGraph(projectId: string, canvasId: string, lightGraph = false) {
  return useQuery<CanvasGraphResponse>({
    queryKey: [...canvasQueryKeys.detail(projectId, canvasId), lightGraph ? 'summary-v1' : 'full'] as const,
    queryFn: () => lightGraph ? canvasApi.getSummary(projectId, canvasId) : canvasApi.get(projectId, canvasId),
    // 保存不会回写这份缓存，重进时必须拿服务端最新图，否则会先显示删除前的旧节点。
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}
