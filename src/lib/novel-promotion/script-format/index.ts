import { parseStandardScript } from './standard-parser'
import { repairStandardScriptWithLlm } from './llm-repair'
import type { StandardScriptPackage } from './types'

export type {
  ParseStandardScriptOptions,
  StandardScriptCharacter,
  StandardScriptEpisode,
  StandardScriptPackage,
  StandardScriptSource,
  StandardScriptWarning,
} from './types'
export { StandardScriptParseError } from './types'
export {
  normalizeScriptText,
  parseStandardScript,
  validateStandardScriptPackage,
} from './standard-parser'
export {
  buildStandardScriptRepairPrompt,
  normalizeLlmRepairedPackage,
  repairStandardScriptWithLlm,
} from './llm-repair'

export type FormatScriptInput = {
  rawText: string
  fileName?: string
  userId?: string
  model?: string
  projectId?: string
  enableLlmRepair?: boolean
}

export async function formatScriptPackage(input: FormatScriptInput): Promise<StandardScriptPackage> {
  try {
    return parseStandardScript(input.rawText, {
      fileName: input.fileName,
      mode: 'relaxed',
    })
  } catch (error) {
    if (!input.enableLlmRepair || !input.userId || !input.model) {
      throw error
    }
    return await repairStandardScriptWithLlm({
      rawText: input.rawText,
      fileName: input.fileName,
      userId: input.userId,
      model: input.model,
      projectId: input.projectId,
    })
  }
}
