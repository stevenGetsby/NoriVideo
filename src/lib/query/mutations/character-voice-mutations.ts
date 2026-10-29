import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import {
  invalidateQueryTemplates,
  requestJsonWithError,
} from './mutation-shared'

export function useUploadProjectCharacterVoice(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({ file, characterId }: { file: File; characterId: string }) => {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('characterId', characterId)

            return await requestJsonWithError(`/api/novel-promotion/${projectId}/character-voice`, {
                method: 'POST',
                body: formData
            }, 'Failed to upload voice')
        },
        onSuccess: invalidateProjectAssets,
    })
}

export function useUpdateProjectCharacterVoiceSettings(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
    return useMutation({
        mutationFn: async ({
            characterId,
            voiceType,
            voiceId,
            customVoiceUrl,
        }: {
            characterId: string
            voiceType: 'kuaizi' | 'uploaded' | null
            voiceId?: string
            customVoiceUrl?: string
        }) => {
            return await requestJsonWithError(`/api/assets/${characterId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scope: 'project',
                    kind: 'character',
                    projectId,
                    voiceType,
                    voiceId,
                    customVoiceUrl,
                }),
            }, '更新音色失败')
        },
        onSettled: invalidateProjectAssets,
    })
}
