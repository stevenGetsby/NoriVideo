import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export function assertCanvasAgentModeSupported(productLine: unknown) {
  if (productLine === 'story') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CANVAS_AGENT_STORY_UNSUPPORTED',
      message: '喵导暂不支持影游画布。',
    })
  }
}

export async function assertCanvasAgentProjectSupported(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { work: { select: { productLine: true } } },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '作品不存在。' })
  assertCanvasAgentModeSupported(project.work?.productLine)
}
