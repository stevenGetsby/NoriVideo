import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'
import { resolveTaskResponse } from '@/lib/task/client'
import { queryKeys } from '../keys'
import {
  invalidateQueryTemplates,
  requestJsonWithError,
  requestTaskResponseWithError,
} from './mutation-shared'

type AsyncTaskSubmission = {
    async: true
    taskId: string
    runId?: string | null
    status?: string | null
    deduped?: boolean
}

function isAsyncTaskSubmission(value: unknown): value is AsyncTaskSubmission {
    if (!value || typeof value !== 'object') return false
    const payload = value as Record<string, unknown>
    return payload.async === true && typeof payload.taskId === 'string' && payload.taskId.length > 0
}

export function useAnalyzeProjectGlobalAssets(projectId: string) {
    return useMutation({
        mutationFn: async () => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/analyze-global`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ async: true }),
                },
                'Failed to analyze global assets',
            )
            const data = await response.json().catch(() => null)
            if (!isAsyncTaskSubmission(data)) {
                throw new Error('Failed to submit global asset analysis task')
            }
            return data
        },
    })
}

/**
 * 从资产中心复制到项目资产
 */

export function useCopyProjectAssetFromGlobal(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({
            type,
            targetId,
            globalAssetId,
        }: {
            type: 'character' | 'location' | 'prop' | 'voice'
            targetId: string
            globalAssetId: string
        }) => {
            return await requestJsonWithError(`/api/assets/${targetId}/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: type,
                    projectId,
                    globalAssetId,
                }),
            }, 'Failed to copy from global')
        },
        onSuccess: invalidateProjectAssets,
    })
}

/**
 * AI 修改镜头提示词（项目）
 */

export function useUpdateProjectConfig(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ key, value }: { key: string; value: unknown }) =>
            await requestJsonWithError(
                `/api/novel-promotion/${projectId}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [key]: value }),
                },
                'Failed to update config',
            ),
        onMutate: async ({ key, value }) => {
            const projectQueryKey = queryKeys.projectData(projectId)
            await queryClient.cancelQueries({ queryKey: projectQueryKey })
            const previousProject = queryClient.getQueryData<Project>(projectQueryKey)

            queryClient.setQueryData<Project | undefined>(projectQueryKey, (prev) => {
                if (!prev?.novelPromotionData) return prev
                return {
                    ...prev,
                    novelPromotionData: {
                        ...prev.novelPromotionData,
                        [key]: value,
                    },
                }
            })

            return { previousProject }
        },
        onError: (_error, _variables, context) => {
            if (context?.previousProject) {
                queryClient.setQueryData(queryKeys.projectData(projectId), context.previousProject)
            }
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectData(projectId)])
        },
    })
}

/**
 * 分析项目资产（异步任务）
 */

export function useAnalyzeProjectAssets(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/analyze`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ episodeId, async: true }),
                },
                'Failed to analyze assets',
            )
            return resolveTaskResponse(response)
        },
        onSettled: (_, __, variables) => {
            invalidateQueryTemplates(queryClient, [
                queryKeys.episodeData(projectId, variables.episodeId),
                queryKeys.projectAssets.all(projectId),
            ])
        },
    })
}

/**
 * 获取下游分镜统计（用于重建确认）
 */

export function useGetProjectStoryboardStats(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) => {
            const data = await requestJsonWithError<{
                counts?: {
                    storyboardCount?: number
                    panelCount?: number
                    imageCount?: number
                    videoCount?: number
                    voiceLineCount?: number
                    voiceAudioCount?: number
                    editorProjectCount?: number
                    exportQueueCount?: number
                    exportHistoryCount?: number
                    activeTaskCount?: number
                }
                shouldConfirm?: boolean
            }>(
                `/api/novel-promotion/${projectId}/rebuild-impact?episodeId=${encodeURIComponent(episodeId)}`,
                { method: 'GET' },
                'rebuild impact check failed',
            )
            return {
                storyboardCount: data.counts?.storyboardCount ?? 0,
                panelCount: data.counts?.panelCount ?? 0,
                imageCount: data.counts?.imageCount ?? 0,
                videoCount: data.counts?.videoCount ?? 0,
                voiceLineCount: data.counts?.voiceLineCount ?? 0,
                voiceAudioCount: data.counts?.voiceAudioCount ?? 0,
                editorProjectCount: data.counts?.editorProjectCount ?? 0,
                exportQueueCount: data.counts?.exportQueueCount ?? 0,
                exportHistoryCount: data.counts?.exportHistoryCount ?? 0,
                activeTaskCount: data.counts?.activeTaskCount ?? 0,
                shouldConfirm: data.shouldConfirm ?? false,
            }
        },
    })
}

/**
 * 获取 VoiceStage 所需数据
 */
