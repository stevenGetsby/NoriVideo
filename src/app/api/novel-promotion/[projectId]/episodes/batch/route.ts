/**
 * 批量创建剧集 API
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
    type EpisodeFrameOSMetadata,
    writeEpisodeFrameOSMetadataToSpeakerVoices,
} from '@/lib/novel-promotion/episode-frameos-metadata'

interface BatchEpisode {
    name: string
    description?: string
    novelText: string
    frameosMetadata?: EpisodeFrameOSMetadata
}

export const POST = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const { episodes, clearExisting = false } = await request.json()

    if (!episodes || !Array.isArray(episodes)) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 验证项目存在
    const project = await prisma.novelPromotionProject.findFirst({
        where: { projectId }
    })

    if (!project) {
        throw new ApiError('NOT_FOUND')
    }

    // 如果需要清空现有剧集
    if (clearExisting) {
        await prisma.novelPromotionEpisode.deleteMany({
            where: { novelPromotionProjectId: project.id }
        })
    }

    if (episodes.length === 0) {
        return NextResponse.json({
            success: true,
            episodes: [],
            message: clearExisting ? '已清空剧集' : '没有剧集需要保存'
        })
    }

    // 获取当前最大剧集编号
    const lastEpisode = await prisma.novelPromotionEpisode.findFirst({
        where: { novelPromotionProjectId: project.id },
        orderBy: { episodeNumber: 'desc' }
    })

    const startNumber = clearExisting ? 1 : (lastEpisode?.episodeNumber || 0) + 1

    // 批量创建剧集
    const createdEpisodes = await prisma.$transaction(
        (episodes as BatchEpisode[]).map((ep, idx) =>
            prisma.novelPromotionEpisode.create({
                data: {
                    novelPromotionProjectId: project.id,
                    episodeNumber: startNumber + idx,
                    name: ep.name,
                    description: ep.description || null,
                    novelText: ep.novelText,
                    speakerVoices: writeEpisodeFrameOSMetadataToSpeakerVoices(null, ep.frameosMetadata || null)
                }
            })
        )
    )

    // 更新项目的 lastEpisodeId 和 importStatus
    const updateData: {
        lastEpisodeId: string
        importStatus: 'completed'
        pendingImportText?: null
        pendingImportEpisodeName?: null
    } = {
        lastEpisodeId: createdEpisodes[0].id,
        importStatus: 'completed',
    }
    if (project.importStatus === 'pending' || project.pendingImportText || project.pendingImportEpisodeName) {
        updateData.pendingImportText = null
        updateData.pendingImportEpisodeName = null
    }

    await prisma.novelPromotionProject.update({
        where: { id: project.id },
        data: updateData
    })

    return NextResponse.json({
        success: true,
        episodes: createdEpisodes.map(ep => ({
            id: ep.id,
            episodeNumber: ep.episodeNumber,
            name: ep.name
        }))
    })
})
