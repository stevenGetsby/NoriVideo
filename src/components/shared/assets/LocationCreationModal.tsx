'use client'
import { logError as _ulogError } from '@/lib/logging/core'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { ART_STYLES } from '@/lib/constants'
import { ArtStyleGridSelector } from '@/components/selectors/ArtStyleGridSelector'
import { CustomArtStyleModal } from '@/components/selectors/CustomArtStyleModal'
import { DirectUploadSection } from './DirectUploadSection'
import { shouldShowError } from '@/lib/error-utils'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { useCustomArtStyleManager } from '@/lib/query/hooks/useCustomArtStyleManager'
import {
    useAiCreateProjectLocation,
    useAiDesignLocation,
    useCreateAssetHubLocation,
    useGenerateLocationImage,
    useCreateProjectLocation,
    useGenerateProjectLocationImage,
} from '@/lib/query/hooks'
import { useImageGenerationCount } from '@/lib/image-generation/use-image-generation-count'
import ImageGenerationInlineCountButton from '@/components/image-generation/ImageGenerationInlineCountButton'
import { getImageGenerationCountOptions } from '@/lib/image-generation/count'
import type { LocationAvailableSlot } from '@/lib/location-available-slots'

export interface LocationCreationModalProps {
    mode: 'asset-hub' | 'project'
    folderId?: string | null
    projectId?: string
    defaultArtStyle?: string
    onClose: () => void
    onSuccess: () => void
}

// 内联 SVG 图标
const XMarkIcon = ({ className }: { className?: string }) => (
    <AppIcon name="close" className={className} />
)

const SparklesIcon = ({ className }: { className?: string }) => (
    <AppIcon name="sparklesAlt" className={className} />
)

export function LocationCreationModal({
    mode,
    folderId,
    projectId,
    defaultArtStyle,
    onClose,
    onSuccess
}: LocationCreationModalProps) {
    const t = useTranslations('assetModal')
    const aiDesignAssetHubLocation = useAiDesignLocation()
    const createAssetHubLocation = useCreateAssetHubLocation()
    const generateAssetHubLocation = useGenerateLocationImage()
    const aiCreateProjectLocation = useAiCreateProjectLocation(projectId || '')
    const createProjectLocation = useCreateProjectLocation(projectId || '')
    const generateProjectLocation = useGenerateProjectLocationImage(projectId || '')
    const {
        count: locationGenerationCount,
        setCount: setLocationGenerationCount,
    } = useImageGenerationCount('location')

    // 表单字段
    const [createMode, setCreateMode] = useState<'generate' | 'upload'>('generate')
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [aiInstruction, setAiInstruction] = useState('')
    const [artStyle, setArtStyle] = useState(defaultArtStyle || 'american-comic')
    const [availableSlots, setAvailableSlots] = useState<LocationAvailableSlot[]>([])
    const [uploadImageUrls, setUploadImageUrls] = useState<string[]>([])
    const customStyleManager = useCustomArtStyleManager({
        selectedValue: artStyle,
        onSelect: setArtStyle,
    })

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isAiDesigning, setIsAiDesigning] = useState(false)
    const aiDesigningState = isAiDesigning
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'image',
            hasOutput: false,
        })
        : null
    const submittingState = isSubmitting
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'image',
            hasOutput: false,
        })
        : null

    const getErrorMessage = (error: unknown, fallback: string) => {
        if (error instanceof Error && error.message) {
            return error.message
        }
        return fallback
    }

    const getErrorStatus = (error: unknown): number | null => {
        if (typeof error === 'object' && error !== null) {
            const status = (error as { status?: unknown }).status
            if (typeof status === 'number') return status
        }
        return null
    }

    // ESC 键关闭
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isSubmitting && !isAiDesigning) {
                onClose()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [onClose, isSubmitting, isAiDesigning])

    // AI 设计描述
    const handleAiDesign = async () => {
        if (!aiInstruction.trim()) return

        try {
            setIsAiDesigning(true)
            const data = mode === 'asset-hub'
                ? await aiDesignAssetHubLocation.mutateAsync(aiInstruction)
                : await aiCreateProjectLocation.mutateAsync({ userInstruction: aiInstruction })
            setDescription(data.prompt || '')
            setAvailableSlots(Array.isArray(data.availableSlots) ? data.availableSlots : [])
            setAiInstruction('')
        } catch (error: unknown) {
            if (getErrorStatus(error) === 402) {
                alert(getErrorMessage(error, t('errors.insufficientBalance')))
            } else {
                _ulogError('AI设计失败:', error)
                if (shouldShowError(error)) {
                    alert(getErrorMessage(error, t('errors.aiDesignFailed')))
                }
            }
        } finally {
            setIsAiDesigning(false)
        }
    }

    type CreatedLocationResponse = {
        location?: {
            id: string
        }
    }

    // 直接上传模式
    const handleUploadDirect = useCallback(async () => {
        if (!name.trim() || uploadImageUrls.length === 0) return
        try {
            setIsSubmitting(true)
            if (mode === 'asset-hub') {
                await createAssetHubLocation.mutateAsync({
                    name: name.trim(),
                    summary: description.trim() || name.trim(),
                    folderId: folderId ?? null,
                    uploadDirect: true,
                    uploadImageUrls,
                })
            } else {
                // Project mode: use unified API which supports uploadDirect
                const res = await fetch('/api/assets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        scope: 'project',
                        kind: 'location',
                        projectId,
                        name: name.trim(),
                        summary: description.trim() || name.trim(),
                        description: description.trim() || name.trim(),
                        uploadDirect: true,
                        uploadImageUrls,
                    }),
                })
                if (!res.ok) throw new Error('上传失败')
            }
            onSuccess()
            onClose()
        } catch (error: unknown) {
            if (shouldShowError(error)) {
                alert(getErrorMessage(error, t('errors.createFailed')))
            }
        } finally {
            setIsSubmitting(false)
        }
    }, [name, description, uploadImageUrls, mode, folderId, projectId, createAssetHubLocation, onSuccess, onClose, t])

    // 提交创建
    const handleSubmit = async () => {
        if (!name.trim() || !description.trim()) return

        try {
            setIsSubmitting(true)

            const body: {
                name: string
                description: string
                artStyle: string
                folderId?: string | null
            } = {
                name: name.trim(),
                description: description.trim(),
                artStyle
            }

            if (mode === 'asset-hub') {
                body.folderId = folderId
            }

            if (mode === 'asset-hub') {
                await createAssetHubLocation.mutateAsync({
                    name: body.name,
                    summary: body.description,
                    artStyle: body.artStyle,
                    folderId: body.folderId ?? null,
                    availableSlots,
                })
            } else {
                await createProjectLocation.mutateAsync({
                    name: body.name,
                    description: body.description,
                    artStyle: body.artStyle,
                    availableSlots,
                })
            }

            onSuccess()
            onClose()
        } catch (error: unknown) {
            if (getErrorStatus(error) === 402) {
                alert(getErrorMessage(error, t('errors.insufficientBalance')))
            } else if (shouldShowError(error)) {
                alert(getErrorMessage(error, t('errors.createFailed')))
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleSubmitAndGenerate = async () => {
        if (!name.trim() || !description.trim()) return

        try {
            setIsSubmitting(true)

            if (mode === 'asset-hub') {
                const result = await createAssetHubLocation.mutateAsync({
                    name: name.trim(),
                    summary: description.trim(),
                    artStyle,
                    folderId: folderId ?? null,
                    count: locationGenerationCount,
                    availableSlots,
                }) as CreatedLocationResponse
                const createdLocationId = result.location?.id
                if (!createdLocationId) {
                    throw new Error(t('errors.createFailed'))
                }
                await generateAssetHubLocation.mutateAsync({
                    locationId: createdLocationId,
                    artStyle,
                    count: locationGenerationCount,
                })
            } else {
                const result = await createProjectLocation.mutateAsync({
                    name: name.trim(),
                    description: description.trim(),
                    artStyle,
                    count: locationGenerationCount,
                    availableSlots,
                }) as CreatedLocationResponse
                const createdLocationId = result.location?.id
                if (!createdLocationId) {
                    throw new Error(t('errors.createFailed'))
                }
                await generateProjectLocation.mutateAsync({
                    locationId: createdLocationId,
                    artStyle,
                    count: locationGenerationCount,
                })
            }

            onSuccess()
            onClose()
        } catch (error: unknown) {
            if (getErrorStatus(error) === 402) {
                alert(getErrorMessage(error, t('errors.insufficientBalance')))
            } else if (shouldShowError(error)) {
                alert(getErrorMessage(error, t('errors.createFailed')))
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    // 处理点击遮罩层关闭
    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget && !isSubmitting && !isAiDesigning) {
            onClose()
        }
    }

    return (
        <div
            className="fixed inset-0 glass-overlay flex items-center justify-center z-50 p-4"
            onClick={handleBackdropClick}
        >
            <div className="glass-surface-modal max-w-2xl w-full max-h-[85vh] flex flex-col">
                <div className="p-6 overflow-y-auto flex-1">
                    {/* 标题 */}
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
                            {t('location.title')}
                        </h3>
                        <button
                            onClick={onClose}
                            className="glass-btn-base glass-btn-soft w-8 h-8 rounded-full flex items-center justify-center text-[var(--glass-text-tertiary)]"
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="space-y-5">
                        {/* 模式切换 */}
                        <div className="flex gap-2 p-1 glass-surface-soft rounded-xl">
                            <button
                                type="button"
                                onClick={() => setCreateMode('generate')}
                                className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${createMode === 'generate'
                                    ? 'bg-[var(--glass-bg-surface)] text-[var(--glass-text-primary)] shadow-sm'
                                    : 'text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-secondary)]'}`}
                            >
                                <span className="flex items-center justify-center gap-1.5">
                                    <SparklesIcon className="w-3.5 h-3.5" /> AI 生成
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setCreateMode('upload')}
                                className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${createMode === 'upload'
                                    ? 'bg-[var(--glass-bg-surface)] text-[var(--glass-text-primary)] shadow-sm'
                                    : 'text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-secondary)]'}`}
                            >
                                <span className="flex items-center justify-center gap-1.5">
                                    <AppIcon name="upload" className="w-3.5 h-3.5" /> 直接上传
                                </span>
                            </button>
                        </div>

                        {/* 场景名称 */}
                        <div className="space-y-2">
                            <label className="glass-field-label block">
                                {t('location.name')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('location.namePlaceholder')}
                                className="glass-input-base w-full px-3 py-2 text-sm"
                            />
                        </div>

                        {mode === 'asset-hub' && createMode === 'generate' && (
                            <div className="space-y-2">
                                <label className="glass-field-label block">
                                    {t('artStyle.title')}
                                </label>
                                <ArtStyleGridSelector
                                    value={artStyle}
                                    onChange={setArtStyle}
                                    options={ART_STYLES}
                                    customOptions={customStyleManager.customStyleOptions}
                                    onAddCustom={customStyleManager.openAddCustomStyle}
                                    onEditCustom={customStyleManager.openEditCustomStyle}
                                    onDeleteCustom={(v) => { void customStyleManager.removeCustomStyle(v) }}
                                />
                            </div>
                        )}

                        {createMode === 'generate' && (
                        <>
                        {/* AI 设计区域 */}
                        <div className="glass-surface-soft rounded-xl p-4 space-y-3 border border-[var(--glass-stroke-base)]">
                            <div className="flex items-center gap-2 text-sm font-medium text-[var(--glass-tone-info-fg)]">
                                <SparklesIcon className="w-4 h-4" />
                                <span>{t('aiDesign.title')} {t('common.optional')}</span>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={aiInstruction}
                                    onChange={(e) => setAiInstruction(e.target.value)}
                                    placeholder={t('aiDesign.placeholderLocation')}
                                    className="glass-input-base flex-1 px-3 py-2 text-sm"
                                    disabled={isAiDesigning}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault()
                                            handleAiDesign()
                                        }
                                    }}
                                />
                                <button
                                    onClick={handleAiDesign}
                                    disabled={isAiDesigning || !aiInstruction.trim()}
                                    className="glass-btn-base glass-btn-tone-info px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm whitespace-nowrap"
                                >
                                    {isAiDesigning ? (
                                        <TaskStatusInline state={aiDesigningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                                    ) : (
                                        <>
                                            <SparklesIcon className="w-4 h-4" />
                                            <span>{t('aiDesign.generate')}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <p className="glass-field-hint">
                                {t('aiDesign.tip')}
                            </p>
                        </div>

                        {/* 场景描述 */}
                        <div className="space-y-2">
                            <label className="glass-field-label block">
                                {t('location.description')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t('location.descPlaceholder')}
                                className="glass-textarea-base w-full h-36 px-3 py-2 text-sm resize-none"
                                disabled={isAiDesigning}
                            />
                        </div>
                        </>
                        )}

                        {createMode === 'upload' && (
                            <DirectUploadSection
                                onImagesReady={setUploadImageUrls}
                                maxImages={5}
                                label="上传场景图片"
                                hint="上传已制作好的场景图片，直接作为场景资产"
                            />
                        )}
                    </div>
                </div>

                {/* 固定底部按钮区 */}
                <div className="flex gap-3 justify-end p-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] rounded-b-xl flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg text-sm"
                        disabled={isSubmitting}
                    >
                        {t('common.cancel')}
                    </button>
                    {createMode === 'upload' ? (
                        <button
                            onClick={() => { void handleUploadDirect() }}
                            disabled={isSubmitting || !name.trim() || uploadImageUrls.length === 0}
                            className="glass-btn-base glass-btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? '上传中...' : '上传并创建'}
                        </button>
                    ) : (
                    <>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !name.trim() || !description.trim()}
                        className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-2"
                    >
                        {isSubmitting ? (
                            <TaskStatusInline state={submittingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        ) : (
                            <span>{mode === 'asset-hub' ? t('common.addOnlyToAssetHubLocation') : t('common.addOnlyLocation')}</span>
                        )}
                    </button>
                    <ImageGenerationInlineCountButton
                        prefix={<span>{t('common.addAndGeneratePrefix')}</span>}
                        suffix={<span>{t('common.generateCountSuffix')}</span>}
                        value={locationGenerationCount}
                        options={getImageGenerationCountOptions('location')}
                        onValueChange={setLocationGenerationCount}
                        onClick={handleSubmitAndGenerate}
                        actionDisabled={!name.trim() || !description.trim()}
                        selectDisabled={isSubmitting}
                        ariaLabel={t('common.selectGenerateCount')}
                        className="glass-btn-base glass-btn-primary flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                        selectClassName="appearance-none bg-transparent border-0 pl-0 pr-3 text-sm font-semibold text-current outline-none cursor-pointer leading-none transition-colors"
                    />
                    </>
                    )}
                </div>

                <CustomArtStyleModal
                    isOpen={customStyleManager.customStyleModalOpen}
                    editingStyle={customStyleManager.editingCustomStyle}
                    onSave={(data) => { void customStyleManager.saveCustomStyle(data) }}
                    onClose={customStyleManager.closeCustomStyleModal}
                />
            </div>
        </div>
    )
}
