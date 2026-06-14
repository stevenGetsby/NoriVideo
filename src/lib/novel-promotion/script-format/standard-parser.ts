import {
  StandardScriptParseError,
  type ParseStandardScriptOptions,
  type StandardScriptCharacter,
  type StandardScriptEpisode,
  type StandardScriptPackage,
  type StandardScriptWarning,
} from './types'

type SectionKey = 'storyBrief' | 'characters' | 'episodes'

type SectionMatch = {
  key: SectionKey
  index: number
}

const STRICT_SECTION_HEADINGS: Record<SectionKey, readonly string[]> = {
  storyBrief: ['故事简介'],
  characters: ['人物设定'],
  episodes: ['分集'],
}

const RELAXED_SECTION_HEADINGS: Record<SectionKey, readonly string[]> = {
  storyBrief: ['故事简介', '故事梗概', '故事概述', '剧情简介', '简介', '故事大纲'],
  characters: ['人物设定', '角色设定', '人物介绍', '角色介绍', '人物小传', '角色小传'],
  episodes: ['分集', '分集剧情', '剧集', '剧集拆分', '剧集规划', '正文分集'],
}

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

function buildHeadingPattern(headings: readonly string[]): RegExp {
  const escaped = headings
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:${escaped})\\s*(?:[:：])?\\s*$`, 'i')
}

function getHeadingPatterns(mode: 'strict' | 'relaxed'): Record<SectionKey, RegExp> {
  const source = mode === 'strict' ? STRICT_SECTION_HEADINGS : RELAXED_SECTION_HEADINGS
  return {
    storyBrief: buildHeadingPattern(source.storyBrief),
    characters: buildHeadingPattern(source.characters),
    episodes: buildHeadingPattern(source.episodes),
  }
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

function matchSectionHeading(line: string, patterns: Record<SectionKey, RegExp>): SectionKey | null {
  for (const key of Object.keys(patterns) as SectionKey[]) {
    if (patterns[key].test(line)) return key
  }
  return null
}

function splitSections(text: string, mode: 'strict' | 'relaxed'): Partial<Record<SectionKey, string>> {
  const patterns = getHeadingPatterns(mode)
  const lines = text.split('\n')
  const matches: SectionMatch[] = []
  for (let index = 0; index < lines.length; index++) {
    const key = matchSectionHeading(lines[index], patterns)
    if (key) matches.push({ key, index })
  }

  const sections: Partial<Record<SectionKey, string>> = {}
  for (let index = 0; index < matches.length; index++) {
    const current = matches[index]
    const next = matches[index + 1]
    if (sections[current.key]) continue
    sections[current.key] = lines
      .slice(current.index + 1, next ? next.index : lines.length)
      .join('\n')
      .trim()
  }
  return sections
}

function compactIdPart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || Math.random().toString(36).slice(2, 8)
}

function stripListPrefix(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·]\s*)?/, '')
    .replace(/^\s*(?:\d+|[一二三四五六七八九十百]+)[.、．)]\s*/, '')
    .trim()
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function extractAliases(rawName: string, description: string): { name: string; aliases: string[] } {
  const aliases: string[] = []
  let name = rawName.trim()

  name = name.replace(/[（(]([^）)]+)[）)]/g, (_, inner: string) => {
    aliases.push(...inner.split(/[、,，/]/).map((item) => item.replace(/^(别名|又名|昵称)[:：]/, '').trim()))
    return ''
  }).trim()

  const aliasMatch = description.match(/(?:别名|又名|昵称)[:：]\s*([^。；;\n]+)/)
  if (aliasMatch?.[1]) {
    aliases.push(...aliasMatch[1].split(/[、,，/]/).map((item) => item.trim()))
  }

  const nameParts = name.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean)
  if (nameParts.length > 1) {
    name = nameParts[0]
    aliases.push(...nameParts.slice(1))
  }

  return {
    name,
    aliases: uniqueStrings(aliases.filter((item) => item !== name)),
  }
}

function parseCharacters(section: string, warnings: StandardScriptWarning[]): StandardScriptCharacter[] {
  const characters: StandardScriptCharacter[] = []
  const lines = section
    .split('\n')
    .map(stripListPrefix)
    .filter(Boolean)

  for (const line of lines) {
    const match = line.match(/^([^:：\-—]{1,40})\s*[:：\-—]\s*(.+)$/)
    if (!match) {
      warnings.push({
        code: 'CHARACTER_LINE_UNPARSED',
        message: `人物行未识别：${line.slice(0, 80)}`,
      })
      continue
    }

    const rawName = match[1].trim()
    const description = match[2].trim()
    const { name, aliases } = extractAliases(rawName, description)
    if (!name || !description) continue

    characters.push({
      id: `character-${compactIdPart(name)}`,
      name,
      description,
      aliases,
    })
  }

  return characters
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
    /^第\s*([0-9一二两三四五六七八九十百]+)\s*[集话章]\s*(?:[:：\-—]\s*)?(.+)?$/,
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

function parseEpisodes(section: string, warnings: StandardScriptWarning[]): StandardScriptEpisode[] {
  const lines = section.split('\n')
  const headings: Array<{ lineIndex: number; episodeNumber: number; title: string }> = []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const heading = matchEpisodeHeading(lines[lineIndex])
    if (heading) headings.push({ lineIndex, ...heading })
  }

  const episodes: StandardScriptEpisode[] = []
  for (let index = 0; index < headings.length; index++) {
    const current = headings[index]
    const next = headings[index + 1]
    const sourceText = lines
      .slice(current.lineIndex + 1, next ? next.lineIndex : lines.length)
      .join('\n')
      .trim()

    const id = `episode-${String(current.episodeNumber).padStart(3, '0')}`
    if (!sourceText) {
      warnings.push({
        code: 'EPISODE_BODY_EMPTY',
        message: `第 ${current.episodeNumber} 集正文为空`,
        targetId: id,
      })
    }

    episodes.push({
      id,
      episodeNumber: current.episodeNumber,
      title: current.title,
      sourceText,
      synopsis: sourceText ? summarizeEpisodeText(sourceText) : undefined,
    })
  }

  return episodes.sort((a, b) => a.episodeNumber - b.episodeNumber)
}

function buildDefaultEpisode(text: string): StandardScriptEpisode {
  const sourceText = text.trim()
  return {
    id: 'episode-001',
    episodeNumber: 1,
    title: '第1集',
    sourceText,
    ...(sourceText ? { synopsis: summarizeEpisodeText(sourceText) } : {}),
  }
}

function parseEpisodesFromScript(params: {
  normalizedText: string
  episodeSection?: string
  warnings: StandardScriptWarning[]
}): StandardScriptEpisode[] {
  const sectionText = params.episodeSection?.trim()
  if (sectionText) {
    const sectionEpisodes = parseEpisodes(sectionText, params.warnings)
    if (sectionEpisodes.length > 0) return sectionEpisodes
  }

  const fullTextEpisodes = parseEpisodes(params.normalizedText, params.warnings)
  if (fullTextEpisodes.length > 0) return fullTextEpisodes

  return [buildDefaultEpisode(params.normalizedText)]
}

export function validateStandardScriptPackage(pkg: StandardScriptPackage): StandardScriptPackage {
  if (pkg.version !== 'standard-script-v1') {
    throw new StandardScriptParseError('PACKAGE_INVALID', '剧本结构版本不受支持')
  }
  if (!pkg.source.normalizedText.trim()) {
    throw new StandardScriptParseError('TEXT_EMPTY', '剧本文本为空')
  }
  if (!pkg.storyBrief.trim()) {
    throw new StandardScriptParseError('STORY_BRIEF_MISSING', '缺少故事简介')
  }
  if (pkg.characters.length === 0) {
    throw new StandardScriptParseError('CHARACTERS_MISSING', '缺少人物设定')
  }
  return pkg
}

export function parseStandardScript(rawText: string, options: ParseStandardScriptOptions = {}): StandardScriptPackage {
  const mode = options.mode || 'relaxed'
  const normalizedText = normalizeScriptText(rawText)
  if (!normalizedText) {
    throw new StandardScriptParseError('TEXT_EMPTY', '剧本文本为空')
  }

  const warnings: StandardScriptWarning[] = []
  const sections = splitSections(normalizedText, mode)
  if (!sections.storyBrief?.trim()) {
    throw new StandardScriptParseError('STORY_BRIEF_MISSING', '未找到故事简介段落')
  }
  if (!sections.characters?.trim()) {
    throw new StandardScriptParseError('CHARACTERS_MISSING', '未找到人物设定段落')
  }

  const characters = parseCharacters(sections.characters, warnings)
  const episodes = parseEpisodesFromScript({
    normalizedText,
    episodeSection: sections.episodes,
    warnings,
  })

  const pkg: StandardScriptPackage = {
    version: 'standard-script-v1',
    source: {
      ...(options.fileName ? { fileName: options.fileName } : {}),
      rawTextLength: rawText.length,
      normalizedText,
    },
    storyBrief: sections.storyBrief.trim(),
    characters,
    episodes,
    warnings,
  }

  return validateStandardScriptPackage(pkg)
}
