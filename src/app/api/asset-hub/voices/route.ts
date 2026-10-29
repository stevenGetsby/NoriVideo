import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { attachMediaFieldsToGlobalVoice } from '@/lib/media/attach'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'

// 获取用户所有音色（支持 folderId 筛选）
export const GET = apiHandler(async (request: NextRequest) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { searchParams } = new URL(request.url)
    const folderId = searchParams.get('folderId')

    const where: Record<string, unknown> = { userId: session.user.id }
    if (folderId === 'null') {
        where.folderId = null
    } else if (folderId) {
        where.folderId = folderId
    }

    const voices = await prisma.globalVoice.findMany({
        where,
        orderBy: { createdAt: 'desc' }
    })

    const signedVoices = await Promise.all(
        voices.map((voice) => attachMediaFieldsToGlobalVoice(voice))
    )

    return NextResponse.json({ voices: signedVoices })
})

// 新建音色
export const POST = apiHandler(async (request: NextRequest) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = await request.json()
    const {
        name,
        description,
        folderId,
        voiceId,
        voiceType,
        customVoiceUrl,
        voicePrompt,
        gender,
        language
    } = body

    if (!name) {
        throw new ApiError('INVALID_PARAMS')
    }

    if (folderId) {
        const folder = await prisma.globalAssetFolder.findUnique({
            where: { id: folderId }
        })
        if (!folder || folder.userId !== session.user.id) {
            throw new ApiError('INVALID_PARAMS')
        }
    }

    const normalizedVoiceId = typeof voiceId === 'string' ? voiceId.trim() : ''
    const normalizedVoiceType = typeof voiceType === 'string' ? voiceType.trim() : ''
    if (normalizedVoiceId && normalizedVoiceType !== 'kuaizi') {
        throw new ApiError('INVALID_PARAMS', { message: '请明确绑定 Kuaizi 音色 ID，或上传参考音频。' })
    }
    if (!normalizedVoiceId && !customVoiceUrl) {
        throw new ApiError('INVALID_PARAMS', { message: '请上传参考音频或填写 Kuaizi 音色 ID。' })
    }
    if (voicePrompt) {
        throw new ApiError('VOICE_DESIGN_RETIRED')
    }

    const customVoiceMedia = await resolveMediaRefFromLegacyValue(customVoiceUrl || null)
    const voice = await prisma.globalVoice.create({
        data: {
            userId: session.user.id,
            folderId: folderId || null,
            name: name.trim(),
            description: description?.trim() || null,
            voiceId: normalizedVoiceId || null,
            voiceType: normalizedVoiceId ? 'kuaizi' : 'uploaded',
            customVoiceUrl: customVoiceUrl || null,
            customVoiceMediaId: customVoiceMedia?.id || null,
            voicePrompt: voicePrompt?.trim() || null,
            gender: gender || null,
            language: language || 'zh'
        }
    })

    const withMedia = await attachMediaFieldsToGlobalVoice(voice)
    return NextResponse.json({ success: true, voice: withMedia })
})
