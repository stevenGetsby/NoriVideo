import { executeAiTextStep } from '@/lib/ai-runtime'
import type { AiStepExecutionInput, AiStepExecutionResult } from '@/lib/ai-runtime/types'
import { safeParseJsonObject } from '@/lib/json-repair'
import {
  normalizeScriptText,
  validateStandardScriptPackage,
} from './standard-parser'
import type {
  StandardScriptCharacter,
  StandardScriptEpisode,
  StandardScriptPackage,
  StandardScriptWarning,
} from './types'

type ExecuteTextStep = (input: AiStepExecutionInput) => Promise<AiStepExecutionResult>

export type RepairStandardScriptInput = {
  rawText: string
  userId: string
  model: string
  projectId?: string
  fileName?: string
  executeTextStep?: ExecuteTextStep
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(readString).filter(Boolean)
}

function normalizeCharacters(value: unknown): StandardScriptCharacter[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index): StandardScriptCharacter | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const name = readString(record.name)
      const description = readString(record.description)
      if (!name || !description) return null
      return {
        id: readString(record.id) || `character-${index + 1}`,
        name,
        description,
        aliases: readStringArray(record.aliases),
      }
    })
    .filter((item): item is StandardScriptCharacter => !!item)
}

function normalizeEpisodes(value: unknown): StandardScriptEpisode[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index): StandardScriptEpisode | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const episodeNumber = readNumber(record.episodeNumber) || index + 1
      const title = readString(record.title) || `第${episodeNumber}集`
      const sourceText = readString(record.sourceText)
      if (!sourceText) return null
      const synopsis = readString(record.synopsis)
      return {
        id: readString(record.id) || `episode-${String(episodeNumber).padStart(3, '0')}`,
        episodeNumber,
        title,
        sourceText,
        ...(synopsis ? { synopsis } : {}),
      }
    })
    .filter((item): item is StandardScriptEpisode => !!item)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
}

function normalizeWarnings(value: unknown): StandardScriptWarning[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): StandardScriptWarning | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const message = readString(record.message)
      if (!message) return null
      return {
        code: 'LLM_REPAIR_USED',
        message,
        ...(readString(record.targetId) ? { targetId: readString(record.targetId) } : {}),
      }
    })
    .filter((item): item is StandardScriptWarning => !!item)
}

export function normalizeLlmRepairedPackage(rawPackage: unknown, input: {
  rawText: string
  fileName?: string
}): StandardScriptPackage {
  const record = rawPackage && typeof rawPackage === 'object' && !Array.isArray(rawPackage)
    ? rawPackage as Record<string, unknown>
    : {}
  const sourceRecord = record.source && typeof record.source === 'object' && !Array.isArray(record.source)
    ? record.source as Record<string, unknown>
    : {}
  const normalizedText = readString(sourceRecord.normalizedText) || normalizeScriptText(input.rawText)

  const pkg: StandardScriptPackage = {
    version: 'standard-script-v1',
    source: {
      ...(input.fileName ? { fileName: input.fileName } : {}),
      rawTextLength: input.rawText.length,
      normalizedText,
    },
    storyBrief: readString(record.storyBrief),
    characters: normalizeCharacters(record.characters),
    episodes: normalizeEpisodes(record.episodes),
    warnings: [
      {
        code: 'LLM_REPAIR_USED',
        message: '标准规则解析失败，已使用 LLM 修复为标准剧本结构。',
      },
      ...normalizeWarnings(record.warnings),
    ],
  }

  return validateStandardScriptPackage(pkg)
}

export function buildStandardScriptRepairPrompt(rawText: string): string {
  return [
    '你是剧本结构化助手。请把用户输入整理成严格 JSON，不要输出 Markdown，不要输出解释。',
    '目标 JSON schema:',
    JSON.stringify({
      version: 'standard-script-v1',
      source: {
        normalizedText: '清洗后的完整原文',
      },
      storyBrief: '故事简介。必须是原文可支持的内容，不要编造。',
      characters: [
        {
          id: 'character-001',
          name: '人物名',
          description: '人物设定描述',
          aliases: ['别名'],
        },
      ],
      episodes: [
        {
          id: 'episode-001',
          episodeNumber: 1,
          title: '集标题',
          sourceText: '该集正文或原文片段',
          synopsis: '该集摘要',
        },
      ],
      warnings: [
        {
          message: '如果有不确定处，在这里说明',
        },
      ],
    }, null, 2),
    '要求:',
    '1. 只使用输入中出现的信息，不要新增剧情。',
    '2. 如果原文已有分集，保留原分集边界；如果只有轻微格式问题，只修复格式。',
    '3. characters 至少包含主要人物；episodes 至少包含一个有效分集。',
    '4. sourceText 必须来自输入文本，不要写空。',
    '',
    '输入文本:',
    rawText.slice(0, 80_000),
  ].join('\n')
}

export async function repairStandardScriptWithLlm(input: RepairStandardScriptInput): Promise<StandardScriptPackage> {
  const model = input.model.trim()
  if (!model) throw new Error('analysisModel is required')
  const rawText = normalizeScriptText(input.rawText)
  if (!rawText) throw new Error('rawText is required')

  const executeTextStep = input.executeTextStep || executeAiTextStep
  const completion = await executeTextStep({
    userId: input.userId,
    model,
    messages: [{ role: 'user', content: buildStandardScriptRepairPrompt(rawText) }],
    temperature: 0.1,
    projectId: input.projectId || 'script-format',
    action: 'script_format_repair',
    meta: {
      stepId: 'script_format_repair',
      stepTitle: '剧本格式修复',
      stepIndex: 1,
      stepTotal: 1,
    },
    maxTokens: 12_000,
  })

  const parsed = safeParseJsonObject(completion.text)
  return normalizeLlmRepairedPackage(parsed, {
    rawText,
    fileName: input.fileName,
  })
}
