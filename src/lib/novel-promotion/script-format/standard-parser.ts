import {
  EpisodeSplitParseError,
  type EpisodeSplitPackage,
  type EpisodeSplitWarning,
  type ParsedScriptEpisode,
  type ParseScriptEpisodesOptions,
} from './types'

const CHINESE_NUMERAL: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  百: 100,
}

type EpisodeHeading = {
  lineIndex: number
  episodeNumber: number
  title: string
}

export function normalizeScriptText(rawText: string): string {
  return rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function chineseNumberToInt(value: string): number | null {
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10)
  if (!value) return null

  let total = 0
  let current = 0
  for (const char of value) {
    const digit = CHINESE_NUMERAL[char]
    if (digit === undefined) return null
    if (digit === 10 || digit === 100) {
      current = current || 1
      total += current * digit
      current = 0
    } else {
      current = digit
    }
  }
  return total + current
}

function matchEpisodeHeading(line: string): { episodeNumber: number; title: string } | null {
  const trimmed = line.trim()
  const patterns = [
    /^第\s*([0-9一二两三四五六七八九十百]+)\s*集\s*(?:[:：\-—]\s*)?(.+)?$/,
    /^(?:EP|Episode)\s*0*([0-9]+)\s*(?:[:：\-—]\s*)?(.+)?$/i,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (!match) continue
    const episodeNumber = chineseNumberToInt(match[1])
    if (!episodeNumber || episodeNumber < 1) return null
    return {
      episodeNumber,
      title: (match[2] || `第${episodeNumber}集`).trim() || `第${episodeNumber}集`,
    }
  }

  return null
}

function summarizeEpisodeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

function buildEpisode(params: {
  episodeNumber: number
  title: string
  sourceText: string
  warnings: EpisodeSplitWarning[]
}): ParsedScriptEpisode {
  const id = `episode-${String(params.episodeNumber).padStart(3, '0')}`
  const sourceText = params.sourceText.trim()
  if (!sourceText) {
    params.warnings.push({
      code: 'EPISODE_BODY_EMPTY',
      message: `第 ${params.episodeNumber} 集正文为空`,
      targetId: id,
    })
  }
  return {
    id,
    episodeNumber: params.episodeNumber,
    title: params.title,
    sourceText,
    ...(sourceText ? { synopsis: summarizeEpisodeText(sourceText) } : {}),
  }
}

function collectEpisodeHeadings(lines: string[]): EpisodeHeading[] {
  const headings: EpisodeHeading[] = []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const heading = matchEpisodeHeading(lines[lineIndex])
    if (heading) headings.push({ lineIndex, ...heading })
  }
  return headings
}

function splitEpisodesFromHeadings(lines: string[], headings: EpisodeHeading[], warnings: EpisodeSplitWarning[]) {
  const episodes: ParsedScriptEpisode[] = []
  for (let index = 0; index < headings.length; index++) {
    const current = headings[index]
    const next = headings[index + 1]
    const sourceText = lines
      .slice(current.lineIndex + 1, next ? next.lineIndex : lines.length)
      .join('\n')
      .trim()
    episodes.push(buildEpisode({
      episodeNumber: current.episodeNumber,
      title: current.title,
      sourceText,
      warnings,
    }))
  }
  return episodes.sort((a, b) => a.episodeNumber - b.episodeNumber)
}

export function parseScriptEpisodes(
  rawText: string,
  options: ParseScriptEpisodesOptions = {},
): EpisodeSplitPackage {
  const normalizedText = normalizeScriptText(rawText)
  if (!normalizedText) {
    throw new EpisodeSplitParseError('TEXT_EMPTY', '剧本文本为空')
  }

  const warnings: EpisodeSplitWarning[] = []
  const lines = normalizedText.split('\n')
  const headings = collectEpisodeHeadings(lines)
  const episodes = headings.length > 0
    ? splitEpisodesFromHeadings(lines, headings, warnings)
    : [
      buildEpisode({
        episodeNumber: 1,
        title: '第1集',
        sourceText: normalizedText,
        warnings,
      }),
    ]

  if (headings.length === 0) {
    warnings.push({
      code: 'NO_EPISODE_HEADING_DEFAULTED',
      message: '未检测到分集标题，已将全文作为第 1 集。',
      targetId: 'episode-001',
    })
  }

  return {
    version: 'episode-split-v1',
    source: {
      ...(options.fileName ? { fileName: options.fileName } : {}),
      rawTextLength: rawText.length,
      normalizedText,
    },
    episodes,
    warnings,
  }
}
