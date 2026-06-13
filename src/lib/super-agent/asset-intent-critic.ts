export type AgentAssetRegionIntent = 'china' | 'western' | 'neutral'

export type AgentAssetIntentCritic = {
  regionIntent: AgentAssetRegionIntent
  regionLabel: string
  defaultLocationName: string
  regionConstraint: string
  environmentSignage: string
}

function normalizeText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n')
    .trim()
}

function countCjk(text: string): number {
  return (text.match(/[\u3400-\u9fff]/g) || []).length
}

function countLatinWords(text: string): number {
  return (text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length
}

export function inferAgentAssetIntentCritic(parts: Array<string | null | undefined>): AgentAssetIntentCritic {
  const text = normalizeText(parts)
  const westernPattern = /\b(english|american|united\s+states|western|european|foreign|overseas|new\s+york|los\s+angeles|london)\b|欧美|美国|英文口型|英文环境|国外|海外|现代美国|西方/i
  const chinaPattern = /中国故事|中国场景|中文环境|中国生活|现代中国|国风|中式|北京|上海|深圳|广州|成都|杭州|中国|中文|国内/

  const hasWestern = westernPattern.test(text)
  const hasChina = chinaPattern.test(text)
  const mostlyEnglish = countLatinWords(text) >= 16 && countLatinWords(text) > countCjk(text)
  const mostlyChinese = countCjk(text) >= 16

  if (hasWestern) {
    return {
      regionIntent: 'western',
      regionLabel: '英文/欧美/国外语境',
      defaultLocationName: '国外真实场景',
      regionConstraint: '英文/欧美故事必须保持国外场景、英文环境标识、国外生活或行业语境；不得误生成中国街景、中文招牌或中文口型。',
      environmentSignage: '英文环境标识',
    }
  }

  if (hasChina || mostlyChinese) {
    return {
      regionIntent: 'china',
      regionLabel: '中国/中文语境',
      defaultLocationName: '中国真实生活场景',
      regionConstraint: '中国故事必须使用中国场景、中文环境标识和中国生活语境；不得误生成欧美街景、英文招牌或国外医院/办公室语境。',
      environmentSignage: '中文环境标识',
    }
  }

  if (mostlyEnglish) {
    return {
      regionIntent: 'western',
      regionLabel: '英文/欧美/国外语境',
      defaultLocationName: '国外真实场景',
      regionConstraint: '英文/欧美故事必须保持国外场景、英文环境标识、国外生活或行业语境；不得误生成中国街景、中文招牌或中文口型。',
      environmentSignage: '英文环境标识',
    }
  }

  return {
    regionIntent: 'neutral',
    regionLabel: '按 prompt 明确语境执行',
    defaultLocationName: '核心展示场景',
    regionConstraint: '地域语境按 prompt、剧本和角色设定执行；若 prompt 未指定，不主动加入无关国家、城市、招牌或文化符号。',
    environmentSignage: '不主动生成无关文字标识',
  }
}

export function decorateLocationSummaryWithIntent(summary: string, critic: AgentAssetIntentCritic): string {
  const base = summary.trim()
  const constraint = `地域/语言 critic：${critic.regionConstraint}`
  if (!base) return constraint
  if (base.includes('地域/语言 critic：')) return base
  return `${base}${base.endsWith('。') ? '' : '。'}${constraint}`
}
