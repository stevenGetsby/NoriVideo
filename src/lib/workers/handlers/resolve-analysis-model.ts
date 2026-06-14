import { prisma } from '@/lib/prisma'
import { composeModelKey, parseModelKeyStrict } from '@/lib/model-config-contract'
import { LUMINA_GPT55_MODEL_KEY } from '@/lib/lumina-fixed-models'

type ResolveAnalysisModelInput = {
  userId: string
  inputModel?: unknown
  projectAnalysisModel?: unknown
}

function normalizeModelKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parseModelKeyStrict(trimmed)
  if (!parsed) return null
  return composeModelKey(parsed.provider, parsed.modelId)
}

export async function resolveAnalysisModel(input: ResolveAnalysisModelInput): Promise<string> {
  const modelFromInput = normalizeModelKey(input.inputModel)
  if (modelFromInput) return modelFromInput

  const modelFromProject = normalizeModelKey(input.projectAnalysisModel)
  if (modelFromProject) return modelFromProject

  const userPreference = await prisma.userPreference.findUnique({
    where: { userId: input.userId },
    select: { analysisModel: true },
  })
  const modelFromUserPreference = normalizeModelKey(userPreference?.analysisModel)
  if (modelFromUserPreference) return modelFromUserPreference

  return LUMINA_GPT55_MODEL_KEY
}
