import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * PATCH /api/novel-promotion/[projectId]/clips/[clipId]
 * 更新单个 Clip 的信息
 * 支持更新：characters, location, props, content, screenplay
 */
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string; clipId: string }> }
) => {
    const { projectId, clipId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    const { characters, location, props, content, screenplay } = body
    const clipModel = prisma.novelPromotionClip as unknown as {
        update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
    }

    const novelPromotionProject = await prisma.novelPromotionProject.findUnique({
        where: { projectId },
        select: { id: true }
    })
    if (!novelPromotionProject) {
        throw new ApiError('NOT_FOUND')
    }

    const existingClip = await prisma.novelPromotionClip.findFirst({
        where: {
            id: clipId,
            episode: {
                novelPromotionProjectId: novelPromotionProject.id
            }
        },
        select: { id: true }
    })
    if (!existingClip) {
        throw new ApiError('NOT_FOUND')
    }

    const updateData: {
        characters?: string | null
        location?: string | null
        props?: string | null
        content?: string
        screenplay?: string | null
    } = {}
    if (characters !== undefined) updateData.characters = characters // JSON string
    if (location !== undefined) updateData.location = location
    if (props !== undefined) updateData.props = props
    if (content !== undefined) updateData.content = content
    if (screenplay !== undefined) updateData.screenplay = screenplay // JSON string

    const clip = await clipModel.update({
        where: { id: existingClip.id },
        data: updateData
    })

    return NextResponse.json({ success: true, clip })
})
