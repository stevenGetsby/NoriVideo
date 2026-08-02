import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import {
    buildPanelSeedanceReferenceAssets,
    mergePanelSeedanceReferenceAssets,
    readPanelSeedanceReferenceAssetsFromActingNotes,
    writePanelSeedanceReferenceAssetsToActingNotes,
} from '@/lib/novel-promotion/seedance-reference-assets'
import { readPanelFrameOSMetadataFromActingNotes } from '@/lib/novel-promotion/panel-frameos-metadata'

type StoryboardPanelLike = {
    characters?: string | null
    props?: string | null
    location?: string | null
    actingNotes?: string | null
}

type SeedanceDisplaySource = {
    seedanceAssetUri: string | null
    imageUrl: string | null
    imageUrls: string | null
    selectedIndex: number | null
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

function readCharacterRefsJson(value: string | null | undefined): Array<{
    name: string
    appearance: string | null
    appearanceId: string | null
}> {
    if (!value) return []
    try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.map((item) => {
            if (typeof item === 'string') return { name: item.trim(), appearance: null, appearanceId: null }
            if (!item || typeof item !== 'object') return { name: '', appearance: null, appearanceId: null }
            const row = item as { name?: unknown; appearance?: unknown; appearanceId?: unknown }
            return {
                name: typeof row.name === 'string' ? row.name.trim() : '',
                appearance: typeof row.appearance === 'string' ? row.appearance.trim() : null,
                appearanceId: typeof row.appearanceId === 'string' ? row.appearanceId.trim() : null,
            }
        }).filter((item) => item.name)
    } catch {
        return []
    }
}

function readDisplayImage(source: SeedanceDisplaySource): string | null {
    if (source.imageUrl?.trim()) return source.imageUrl.trim()
    if (!source.imageUrls?.trim()) return null
    try {
        const parsed = JSON.parse(source.imageUrls) as unknown
        if (!Array.isArray(parsed)) return null
        const urls = parsed
            .map((value) => typeof value === 'string' ? value.trim() : '')
            .filter(Boolean)
        if (urls.length === 0) return null
        const selectedIndex = typeof source.selectedIndex === 'number' ? source.selectedIndex : 0
        return urls[Math.max(0, Math.min(selectedIndex, urls.length - 1))] || urls[0] || null
    } catch {
        return null
    }
}

async function loadSeedanceDisplayUrls(
    projectId: string,
    storyboards: Array<{ panels?: StoryboardPanelLike[] }>,
): Promise<Map<string, string>> {
    const assetUris = Array.from(new Set(storyboards.flatMap((storyboard) => (
        (storyboard.panels || []).flatMap((panel) => (
            readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes)
                .map((asset) => asset.imageUrl.trim())
                .filter((value) => value.startsWith('asset://'))
        ))
    ))))
    if (assetUris.length === 0) return new Map()

    const appearances = await prisma.characterAppearance.findMany({
        where: {
            seedanceAssetUri: { in: assetUris },
            character: {
                novelPromotionProject: { projectId },
            },
        },
        select: {
            seedanceAssetUri: true,
            imageUrl: true,
            imageUrls: true,
            selectedIndex: true,
        },
    })

    const result = new Map<string, string>()
    for (const appearance of appearances) {
        const assetUri = appearance.seedanceAssetUri?.trim()
        const displayImage = readDisplayImage(appearance)
        if (assetUri && displayImage) result.set(assetUri, displayImage)
    }
    return result
}

function buildPanelAssetBindings(panel: StoryboardPanelLike, seedanceDisplayUrls: Map<string, string>) {
    const seedanceRefs = readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes)
    if (seedanceRefs.length > 0) {
        return seedanceRefs.map((asset) => ({
            materialId: asset.materialId || null,
            kind: asset.kind === 'character' ? '角色' : asset.kind === 'prop' ? '物品' : '环境',
            name: asset.name,
            appearance: asset.appearance || null,
            appearanceId: asset.appearanceId || null,
            imageUrl: asset.imageUrl.startsWith('asset://')
                ? seedanceDisplayUrls.get(asset.imageUrl) || null
                : asset.imageUrl,
        }))
    }

    return [
        ...readCharacterRefsJson(panel.characters).map((character) => ({
            kind: '角色',
            name: character.name,
            appearance: character.appearance,
            appearanceId: character.appearanceId,
            imageUrl: null,
        })),
        ...(panel.location ? [{ kind: '环境', name: panel.location, imageUrl: null }] : []),
        ...readNamesJson(panel.props).map((name) => ({ kind: '物品', name, imageUrl: null })),
    ]
}

function attachPanelAssetBindings<T extends { panels?: StoryboardPanelLike[] }>(
    storyboard: T,
    seedanceDisplayUrls: Map<string, string>,
): T {
    return {
        ...storyboard,
        panels: (storyboard.panels || []).map((panel) => ({
            ...panel,
            assetBindings: buildPanelAssetBindings(panel, seedanceDisplayUrls),
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
        select: {
            id: true,
            episodeNumber: true,
            novelPromotionProject: {
                include: {
                    characters: {
                        include: {
                            appearances: { orderBy: { appearanceIndex: 'asc' } },
                        },
                    },
                    locations: {
                        include: {
                            selectedImage: true,
                            images: { orderBy: { imageIndex: 'asc' } },
                        },
                    },
                },
            },
        }
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

    // Legacy panels may only contain a character name and a stale primary
    // image. Re-resolve automatic bindings from the current episode/scene on
    // every read; explicit images added from Materials remain attached.
    const resolvedStoryboards = storyboards.map((storyboard) => ({
        ...storyboard,
        panels: storyboard.panels.map((panel) => {
            const generated = buildPanelSeedanceReferenceAssets({
                panel: {
                    characters: panel.characters,
                    location: panel.location,
                    props: panel.props,
                    videoPrompt: panel.videoPrompt,
                },
                characterAssets: episode.novelPromotionProject.characters,
                locationAssets: episode.novelPromotionProject.locations,
                episodeNumber: episode.episodeNumber,
                sceneId: readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)?.panel_id?.match(/^S\d+/i)?.[0] || null,
            })
            const references = mergePanelSeedanceReferenceAssets(
                generated,
                readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes),
            )
            return {
                ...panel,
                actingNotes: writePanelSeedanceReferenceAssetsToActingNotes(panel.actingNotes, references),
            }
        }),
    }))

    const [withMedia, seedanceDisplayUrls] = await Promise.all([
        attachMediaFieldsToProject({ storyboards: resolvedStoryboards }),
        loadSeedanceDisplayUrls(projectId, resolvedStoryboards),
    ])
    const processedStoryboards = (withMedia.storyboards || resolvedStoryboards)
        .map((storyboard) => attachPanelAssetBindings(storyboard, seedanceDisplayUrls))

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
