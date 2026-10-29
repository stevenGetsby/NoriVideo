import { logInfo as _ulogInfo } from '@/lib/logging/core'
/**
 * 生成器统一入口（增强版）
 * 
 * 支持：
 * - 严格使用 model_key（provider::modelId）
 * - 用户自定义模型的动态路由（仅通过配置中心）
 * - 统一错误处理
 */

import type { GenerateResult } from './generators/base'
import { getProviderKey, resolveModelSelection, type ModelSelection } from './api-config'
import { generateKuaiziAudio, generateKuaiziImage, generateKuaiziVideo } from './providers/kuaizi'
import { resolveRuntimeModelKey } from './nori-model-catalog'
import { parseModelKeyStrict } from './model-config-contract'
import { recordServiceUsageInBackground } from './platform-services/usage'
import { assertCanvasImageInpaintSupported } from './canvas/image-edit-contract'

const MEDIA_PROVIDER_ID = 'kuaizi'

/**
 * New media generation must run on the Kuaizi platform. Historical provider
 * branches are intentionally not reachable from this entry point.
 */
function assertKuaiziMediaSelection(selection: ModelSelection): void {
    const providerKey = getProviderKey(selection.provider).toLowerCase()
    if (providerKey !== MEDIA_PROVIDER_ID) {
        throw new Error(
            `MEDIA_PROVIDER_UNSUPPORTED: ${selection.mediaType} generation requires ${MEDIA_PROVIDER_ID}, got ${selection.modelKey}`,
        )
    }
}

/**
 * 生成图片（简化版）
 * 
 * @param userId 用户 ID
 * @param modelKey 模型唯一键（provider::modelId）
 * @param prompt 提示词
 * @param options 生成选项
 */
async function generateImageInternal(
    userId: string,
    modelKey: string,
    prompt: string,
    options?: {
        referenceImages?: string[]
        aspectRatio?: string
        resolution?: string
        quality?: 'low' | 'medium' | 'high'
        outputFormat?: string
        keepOriginalAspectRatio?: boolean  // 🔥 编辑时保持原图比例
        size?: string  // 🔥 直接指定像素尺寸如 "5016x3344"（优先于 aspectRatio）
        editMode?: 'inpaint'
        maskImage?: string
    }
): Promise<GenerateResult> {
    const selection = await resolveModelSelection(userId, modelKey, 'image')
    assertKuaiziMediaSelection(selection)
    _ulogInfo(`[generateImage] resolved model selection: ${selection.modelKey}`)
    const { referenceImages, editMode, maskImage, ...generatorOptions } = options || {}
    if (maskImage && editMode !== 'inpaint') {
        throw new Error('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID: maskImage requires editMode=inpaint')
    }
    if (editMode === 'inpaint') {
        assertCanvasImageInpaintSupported(modelKey)
        if (!maskImage?.trim()) {
            throw new Error('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID: image_edit requires maskImage')
        }
        if (referenceImages?.length !== 1) {
            throw new Error('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID: image_edit requires exactly one source image')
        }
    }
    return await generateKuaiziImage({
        userId,
        prompt,
        referenceImages,
        options: {
            ...generatorOptions,
            provider: selection.provider,
            modelId: selection.modelId,
            modelKey: selection.modelKey,
        },
    })
}

export async function generateImage(
    userId: string,
    modelKey: string,
    prompt: string,
    options?: {
        referenceImages?: string[]
        aspectRatio?: string
        resolution?: string
        quality?: 'low' | 'medium' | 'high'
        outputFormat?: string
        keepOriginalAspectRatio?: boolean
        size?: string
        editMode?: 'inpaint'
        maskImage?: string
    },
): Promise<GenerateResult> {
    const startedAt = Date.now()
    const runtimeModelKey = resolveRuntimeModelKey(modelKey) || modelKey
    const parsed = parseModelKeyStrict(runtimeModelKey)
    const requestedModel = parseModelKeyStrict(modelKey)
    const usageModelKey = requestedModel?.provider === 'nori'
        ? requestedModel.modelKey
        : parsed?.modelKey || runtimeModelKey
    try {
        const result = await generateImageInternal(userId, modelKey, prompt, options)
        recordServiceUsageInBackground({
            provider: parsed?.provider || 'unknown',
            modelKey: usageModelKey,
            serviceType: 'image',
            operation: 'generate-image',
            status: result.success ? 'success' : 'failed',
            userId,
            latencyMs: Date.now() - startedAt,
            units: result.imageUrls?.length || (result.success ? 1 : 0),
            errorCode: result.success ? null : 'GENERATION_FAILED',
        })
        return result
    } catch (error) {
        recordServiceUsageInBackground({
            provider: parsed?.provider || 'unknown',
            modelKey: usageModelKey,
            serviceType: 'image',
            operation: 'generate-image',
            status: 'failed',
            userId,
            latencyMs: Date.now() - startedAt,
            units: 0,
            errorCode: error instanceof Error ? error.name : 'GENERATION_ERROR',
        })
        throw error
    }
}

/**
 * 生成视频（增强版）
 * 
 * @param userId 用户 ID
 * @param modelKey 模型唯一键（provider::modelId）
 * @param imageUrl 输入图片 URL
 * @param options 生成选项
 */
async function generateVideoInternal(
    userId: string,
    modelKey: string,
    imageUrl: string,
    options?: {
        prompt?: string
        referenceImages?: string[]
        duration?: number
        fps?: number
        resolution?: string      // '720p' | '1080p'
        aspectRatio?: string     // '16:9' | '9:16'
        generateAudio?: boolean  // 仅 Seedance 1.5 Pro 支持
        lastFrameImageUrl?: string  // 首尾帧模式的尾帧图片
        returnLastFrame?: boolean
        executionExpiresAfter?: number
        moderationIps?: string[]
        safetyIdentifier?: string
        bitrateMode?: string
        outputFormat?: string
        omniReferenceTaskType?: 'auto' | 'reference' | 'edit' | 'extend'
        [key: string]: string | number | boolean | string[] | undefined
    }
): Promise<GenerateResult> {
    const selection = await resolveModelSelection(userId, modelKey, 'video')
    assertKuaiziMediaSelection(selection)
    _ulogInfo(`[generateVideo] resolved model selection: ${selection.modelKey}`)
    return await generateKuaiziVideo({
        userId,
        imageUrl,
        prompt: options?.prompt,
        options: {
            ...(options || {}),
            provider: selection.provider,
            modelId: selection.modelId,
            modelKey: selection.modelKey,
        },
    })
}

export async function generateVideo(
    userId: string,
    modelKey: string,
    imageUrl: string,
    options?: {
        prompt?: string
        referenceImages?: string[]
        duration?: number
        fps?: number
        resolution?: string
        aspectRatio?: string
        generateAudio?: boolean
        lastFrameImageUrl?: string
        returnLastFrame?: boolean
        executionExpiresAfter?: number
        moderationIps?: string[]
        safetyIdentifier?: string
        bitrateMode?: string
        outputFormat?: string
        omniReferenceTaskType?: 'auto' | 'reference' | 'edit' | 'extend'
        [key: string]: string | number | boolean | string[] | undefined
    },
): Promise<GenerateResult> {
    const startedAt = Date.now()
    const runtimeModelKey = resolveRuntimeModelKey(modelKey) || modelKey
    const parsed = parseModelKeyStrict(runtimeModelKey)
    const requestedDuration = typeof options?.duration === 'number' && Number.isFinite(options.duration) && options.duration > 0
        ? options.duration
        : 0
    try {
        const result = await generateVideoInternal(userId, modelKey, imageUrl, options)
        const asyncSubmission = result.success
            && !result.videoUrl
            && Boolean(result.externalId || result.requestId || result.async)
        // Async video generation is recorded once when the task reaches a
        // terminal success and Ark's exact completion_tokens are available.
        // Recording the submission here would double-count every Seedance job.
        if (!asyncSubmission) {
            recordServiceUsageInBackground({
                provider: parsed?.provider || 'unknown',
                modelKey: parsed?.modelKey || runtimeModelKey,
                serviceType: 'video',
                operation: 'generate-video',
                status: result.success ? 'success' : 'failed',
                userId,
                latencyMs: Date.now() - startedAt,
                // Video units are duration seconds. Call count is derived from
                // successful record rows, so these two metrics no longer
                // overwrite each other in the usage report.
                units: result.success ? requestedDuration : 0,
                errorCode: result.success ? null : 'GENERATION_FAILED',
            })
        }
        return result
    } catch (error) {
        recordServiceUsageInBackground({
            provider: parsed?.provider || 'unknown',
            modelKey: parsed?.modelKey || runtimeModelKey,
            serviceType: 'video',
            operation: 'generate-video',
            status: 'failed',
            userId,
            latencyMs: Date.now() - startedAt,
            units: 0,
            errorCode: error instanceof Error ? error.name : 'GENERATION_ERROR',
        })
        throw error
    }
}

/**
 * 生成语音
 */
export async function generateAudio(
    userId: string,
    modelKey: string,
    text: string,
    options?: {
        voice?: string
        rate?: number
    }
): Promise<GenerateResult> {
    const startedAt = Date.now()
    const runtimeModelKey = resolveRuntimeModelKey(modelKey) || modelKey
    const parsed = parseModelKeyStrict(runtimeModelKey)
    try {
        const selection = await resolveModelSelection(userId, modelKey, 'audio')
        assertKuaiziMediaSelection(selection)
        const result = await generateKuaiziAudio({
            userId,
            text,
            voice: options?.voice,
            rate: options?.rate,
            options: {
                provider: selection.provider,
                modelId: selection.modelId,
                modelKey: selection.modelKey,
            },
        })
        const asyncSubmission = result.success
            && !result.audioUrl
            && Boolean(result.externalId || result.requestId || result.async)
        // Async audio is recorded when the billed task settles with the
        // actual duration. Recording the submission here would count 1s
        // and then double-count the completed clip.
        if (!asyncSubmission) {
            recordServiceUsageInBackground({
                provider: parsed?.provider || 'unknown',
                modelKey: parsed?.modelKey || runtimeModelKey,
                serviceType: 'audio',
                operation: 'generate-audio',
                status: result.success ? 'success' : 'failed',
                userId,
                latencyMs: Date.now() - startedAt,
                units: result.success ? 1 : 0,
                errorCode: result.success ? null : 'GENERATION_FAILED',
            })
        }
        return result
    } catch (error) {
        recordServiceUsageInBackground({
            provider: parsed?.provider || 'unknown',
            modelKey: parsed?.modelKey || runtimeModelKey,
            serviceType: 'audio',
            operation: 'generate-audio',
            status: 'failed',
            userId,
            latencyMs: Date.now() - startedAt,
            units: 0,
            errorCode: error instanceof Error ? error.name : 'GENERATION_ERROR',
        })
        throw error
    }
}
