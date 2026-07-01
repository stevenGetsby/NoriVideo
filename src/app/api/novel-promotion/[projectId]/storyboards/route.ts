import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { readPanelSeedanceReferenceAssetsFromActingNotes } from '@/lib/novel-promotion/seedance-reference-assets'

type StoryboardPanelLike = {
    characters?: string | null
    props?: string | null
    location?: string | null
    actingNotes?: string | null
}

function readNamesJson(value: string | null | undefined): string[] {
    if (!value) return []
    try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed
            .map((item) => {
                if (typeof item === 'string') return item.trim()
                if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
                    return ((item as { name: string }).name).trim()
                }
                return ''
            })
            .filter(Boolean)
    } catch {
        return []
    }
}

function buildPanelAssetBindings(panel: StoryboardPanelLike) {
    const seedanceRefs = readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes)
    if (seedanceRefs.length > 0) {
        return seedanceRefs.map((asset) => ({
            kind: asset.kind === 'character' ? '角色' : asset.kind === 'prop' ? '物品' : '环境',
            name: asset.name,
            imageUrl: asset.imageUrl,
        }))
    }

    return [
        ...readNamesJson(panel.characters).map((name) => ({ kind: '角色', name, imageUrl: null })),
        ...(panel.location ? [{ kind: '环境', name: panel.location, imageUrl: null }] : []),
        ...readNamesJson(panel.props).map((name) => ({ kind: '物品', name, imageUrl: null })),
    ]
}

function attachPanelAssetBindings<T extends { panels?: StoryboardPanelLike[] }>(storyboard: T): T {
    return {
        ...storyboard,
        panels: (storyboard.panels || []).map((panel) => ({
            ...panel,
            assetBindings: buildPanelAssetBindings(panel),
        })),
    }
}

/**
 * GET /api/novel-promotion/[projectId]/storyboards
 * 获取剧集的分镜数据（用于测试页面）
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const { searchParams } = new URL(request.url)
    const episodeId = searchParams.get('episodeId')

    if (!episodeId) {
        throw new ApiError('INVALID_PARAMS')
    }

    const episode = await prisma.novelPromotionEpisode.findFirst({
        where: {
            id: episodeId,
            novelPromotionProject: {
                projectId
            }
        },
        select: { id: true }
    })
    if (!episode) {
        throw new ApiError('NOT_FOUND')
    }

    // 获取剧集的分镜数据
    const storyboards = await prisma.novelPromotionStoryboard.findMany({
        where: { episodeId: episode.id },
        include: {
            clip: true,
            panels: { orderBy: { panelIndex: 'asc' } }
        },
        orderBy: { createdAt: 'asc' }
    })

    const withMedia = await attachMediaFieldsToProject({ storyboards })
    const processedStoryboards = (withMedia.storyboards || storyboards).map(attachPanelAssetBindings)

    return NextResponse.json({ storyboards: processedStoryboards })
})

/**
 * PATCH /api/novel-promotion/[projectId]/storyboards
 * 清除指定 storyboard 的 lastError
 */
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json().catch(() => ({}))
    const storyboardId = typeof body?.storyboardId === 'string' ? body.storyboardId : ''
    if (!storyboardId) {
        throw new ApiError('INVALID_PARAMS')
    }

    const storyboard = await prisma.novelPromotionStoryboard.findFirst({
        where: {
            id: storyboardId,
            episode: {
                novelPromotionProject: {
                    projectId
                }
            }
        },
        select: { id: true }
    })
    if (!storyboard) {
        throw new ApiError('NOT_FOUND')
    }

    await prisma.novelPromotionStoryboard.update({
        where: { id: storyboard.id },
        data: { lastError: null }})

    return NextResponse.json({ success: true })
})
