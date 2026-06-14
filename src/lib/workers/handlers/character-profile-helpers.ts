import { prisma } from '@/lib/prisma'
import { safeParseJsonObject } from '@/lib/json-repair'
import { LUMINA_GPT55_MODEL_KEY } from '@/lib/lumina-fixed-models'

export type AnyObj = Record<string, unknown>

export function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function readRequiredString(value: unknown, field: string): string {
  const text = readText(value).trim()
  if (!text) {
    throw new Error(`${field} is required`)
  }
  return text
}

export function parseVisualResponse(responseText: string): AnyObj {
  return safeParseJsonObject(responseText) as AnyObj
}

export async function resolveProjectModel(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      novelPromotionData: {
        select: {
          id: true,
          analysisModel: true,
        },
      },
    },
  })
  if (!project) throw new Error('Project not found')
  if (!project.novelPromotionData) throw new Error('Novel promotion data not found')
  return {
    ...project,
    novelPromotionData: {
      ...project.novelPromotionData,
      analysisModel: project.novelPromotionData.analysisModel || LUMINA_GPT55_MODEL_KEY,
    },
  }
}
