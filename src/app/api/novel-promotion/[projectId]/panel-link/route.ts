import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

// POST - 更新 panel 的首尾帧链接状态
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const {
    storyboardId,
    panelIndex,
    linked,
    nextStoryboardId,
    nextPanelIndex,
  } = body

  if (!storyboardId || panelIndex === undefined || linked === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (typeof linked !== 'boolean') {
    throw new ApiError('INVALID_PARAMS')
  }

  const currentPanel = await prisma.novelPromotionPanel.findUnique({
    where: {
      storyboardId_panelIndex: {
        storyboardId,
        panelIndex: Number(panelIndex),
      },
    },
    select: {
      id: true,
      storyboard: {
        select: {
          episode: {
            select: {
              novelPromotionProject: {
                select: {
                  projectId: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!currentPanel || currentPanel.storyboard.episode.novelPromotionProject.projectId !== projectId) {
    throw new ApiError('NOT_FOUND')
  }

  if (linked) {
    if (!nextStoryboardId || nextPanelIndex === undefined) {
      throw new ApiError('INVALID_PARAMS')
    }

    const nextPanel = await prisma.novelPromotionPanel.findUnique({
      where: {
        storyboardId_panelIndex: {
          storyboardId: nextStoryboardId,
          panelIndex: Number(nextPanelIndex),
        },
      },
      select: {
        id: true,
        storyboard: {
          select: {
            episode: {
              select: {
                novelPromotionProject: {
                  select: {
                    projectId: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!nextPanel || nextPanel.storyboard.episode.novelPromotionProject.projectId !== projectId) {
      throw new ApiError('NOT_FOUND')
    }
  }

  // 更新 panel 的链接状态
  await prisma.novelPromotionPanel.update({
    where: {
      storyboardId_panelIndex: {
        storyboardId,
        panelIndex: Number(panelIndex),
      }
    },
    data: {
      linkedToNextPanel: linked
    }
  })

  return NextResponse.json({ success: true })
})
