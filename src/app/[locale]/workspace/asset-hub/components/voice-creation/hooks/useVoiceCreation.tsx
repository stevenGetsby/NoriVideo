'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useUploadAssetHubVoice } from '@/lib/query/hooks'
import { resolveTaskPresentationState } from '@/lib/task/presentation'

export interface VoiceCreationModalShellProps {
    isOpen: boolean
    folderId: string | null
    onClose: () => void
    onSuccess: () => void
    /** 预填充的音色名称（如发言人名字） */
    initialVoiceName?: string
}

/**
 * 音色创建只保留参考音频上传。
 * 旧版百炼 AI 声音设计已停用，不再从这里发起设计请求。
 */
export function useVoiceCreation({ isOpen, folderId, onClose, onSuccess, initialVoiceName }: VoiceCreationModalShellProps) {
    const tHub = useTranslations('assetHub')
    const tvCreate = useTranslations('voice.voiceCreate')

    const [voiceName, setVoiceName] = useState(initialVoiceName ?? '')
    const [error, setError] = useState<string | null>(null)
    const [uploadFile, setUploadFile] = useState<File | null>(null)
    const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const uploadSubmittingState = isUploading
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'audio',
            hasOutput: false,
        })
        : null
    const uploadVoiceMutation = useUploadAssetHubVoice()

    const handleFileSelect = useCallback((file: File) => {
        const audioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/x-m4a', 'audio/aac']
        const isValid = audioTypes.includes(file.type) || file.name.match(/\.(mp3|wav|ogg|m4a|aac)$/i)

        if (!isValid) {
            setError(tvCreate('invalidFileType'))
            return
        }

        if (file.size > 50 * 1024 * 1024) {
            setError(tvCreate('fileTooLarge'))
            return
        }

        if (uploadPreviewUrl) {
            URL.revokeObjectURL(uploadPreviewUrl)
        }
        setUploadFile(file)
        setError(null)
        setUploadPreviewUrl(URL.createObjectURL(file))
        setVoiceName((current) => current.trim() ? current : file.name.replace(/\.[^/.]+$/, ''))
    }, [tvCreate, uploadPreviewUrl])

    const handleDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((event: React.DragEvent) => {
        event.preventDefault()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault()
        setIsDragging(false)
        const file = event.dataTransfer.files[0]
        if (file) handleFileSelect(file)
    }, [handleFileSelect])

    const handlePlayUpload = () => {
        if (!uploadPreviewUrl) return
        if (audioRef.current) {
            audioRef.current.pause()
        }
        const audio = new Audio(uploadPreviewUrl)
        audioRef.current = audio
        void audio.play()
    }

    const handleSaveUploaded = async () => {
        if (!uploadFile) return
        if (!voiceName.trim()) {
            setError(tHub('voiceNameRequired'))
            return
        }

        setIsUploading(true)
        setError(null)

        try {
            await uploadVoiceMutation.mutateAsync({
                uploadFile,
                voiceName: voiceName.trim(),
                folderId
            })

            onSuccess()
            handleClose()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : tvCreate('uploadFailed'))
        } finally {
            setIsUploading(false)
        }
    }

    const handleClose = () => {
        setVoiceName(initialVoiceName ?? '')
        setError(null)
        setUploadFile(null)
        if (uploadPreviewUrl) {
            URL.revokeObjectURL(uploadPreviewUrl)
        }
        setUploadPreviewUrl(null)
        setIsUploading(false)
        setIsDragging(false)
        if (audioRef.current) {
            audioRef.current.pause()
        }
        onClose()
    }

    return {
        isOpen,
        voiceName,
        error,
        uploadFile,
        uploadPreviewUrl,
        isUploading,
        isDragging,
        fileInputRef,
        uploadSubmittingState,
        tHub,
        tvCreate,
        setVoiceName,
        setUploadFile,
        setUploadPreviewUrl,
        setIsDragging,
        handleFileSelect,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        handlePlayUpload,
        handleSaveUploaded,
        handleClose,
    }
}

export type VoiceCreationRuntime = ReturnType<typeof useVoiceCreation>
