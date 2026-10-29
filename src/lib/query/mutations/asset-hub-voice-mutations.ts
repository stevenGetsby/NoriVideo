import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  requestJsonWithError,
  requestVoidWithError,
} from './mutation-shared'
import { invalidateGlobalVoices } from './asset-hub-mutations-shared'

export function useDeleteVoice() {
  const queryClient = useQueryClient()
  const invalidateVoices = () => invalidateGlobalVoices(queryClient)

  return useMutation({
    mutationFn: async (voiceId: string) => {
      await requestVoidWithError(
        `/api/asset-hub/voices/${voiceId}`,
        { method: 'DELETE' },
        'Failed to delete voice',
      )
    },
    onSuccess: invalidateVoices,
  })
}

export function useUploadAssetHubVoice() {
  const queryClient = useQueryClient()
  const invalidateVoices = () => invalidateGlobalVoices(queryClient)

  return useMutation({
    mutationFn: async (payload: {
      uploadFile: File
      voiceName: string
      folderId: string | null
    }) => {
      const formData = new FormData()
      formData.append('file', payload.uploadFile)
      formData.append('name', payload.voiceName)
      if (payload.folderId) {
        formData.append('folderId', payload.folderId)
      }
      return await requestJsonWithError('/api/asset-hub/voices/upload', {
        method: 'POST',
        body: formData,
      }, '上传失败')
    },
    onSuccess: invalidateVoices,
  })
}
