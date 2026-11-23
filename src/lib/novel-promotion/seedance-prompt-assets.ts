import { findQuotedDialogueRanges, isInsideQuotedDialogue, normalizePromptMentionName, scanPromptMentions, type PromptMentionMatch } from '@/lib/prompt-mentions'

export type SeedancePromptAssetKind = 'character' | 'location' | 'prop'

export interface SeedancePromptAsset {
  kind: SeedancePromptAssetKind
  name: string
}

interface IndexedPromptAsset {
  asset: SeedancePromptAsset
  imageNumber: number
}

function compact(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().replace(/^@+/, '')
}

function stripMediaTypeSuffix(value: string): string {
  return value.replace(/·(?:图片|音频|视频)$/u, '').trim() || value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isBareBindableName(name: string): boolean {
  return Array.from(name).length >= 2 && !/^\d+$/u.test(name)
}

function replaceOutsideQuotes(
  prompt: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray, source: string) => string | null,
): string {
  if (!prompt) return prompt
  const dialogue = findQuotedDialogueRanges(prompt)
  let result = ''
  let cursor = 0
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(prompt)) !== null) {
    if (match[0].length === 0) { pattern.lastIndex += 1; continue }
    if (isInsideQuotedDialogue(dialogue, match.index)) continue
    const replacement = replacer(match, prompt)
    if (replacement === null) continue
    result += prompt.slice(cursor, match.index) + replacement
    cursor = match.index + match[0].length
  }
  return result + prompt.slice(cursor)
}

function findBoundNameRanges(prompt: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const pattern = /(?:^|[^\w])(?:图|图片|视频|音频)\d+（([^（）]*)）/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(prompt)) !== null) {
    const nameStart = match.index + match[0].length - match[1].length - 1
    ranges.push({ start: nameStart, end: nameStart + match[1].length })
  }
  return ranges
}

function normalizePromptBodyLayout(value: string): string {
  return value
    .replace(/\n{3,}(?=Shot\s+\d+\s*$)/gmu, '\n\n')
    .trim()
}

export function extractSeedanceVideoPromptBody(prompt: string): string {
  let text = (prompt || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^```(?:text|markdown|md)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim()

  const bodyStart = text.match(/(?:^|\n)\s*开场状态[：:]/u)
  if (!bodyStart || bodyStart.index === undefined) return text

  const lineOffset = bodyStart[0].startsWith('\n') ? 1 : 0
  text = text.slice(bodyStart.index + lineOffset).trim()

  const endMarkers = [
    /\n\s*【本分镜负面要求】/u,
    /\n\s*◈\s*画风描述(?:\s*\n|[：:])/u,
    /\n\s*◎\s*(?:参考资产|输出参数)(?:\s*\n|[：:])/u,
  ]
  const endIndex = endMarkers.reduce((nearest, pattern) => {
    const match = pattern.exec(text)
    if (!match || match.index <= 0) return nearest
    return nearest < 0 ? match.index : Math.min(nearest, match.index)
  }, -1)

  return normalizePromptBodyLayout(endIndex >= 0 ? text.slice(0, endIndex) : text)
}

export function isSeedanceVideoPromptBody(prompt: string): boolean {
  const body = extractSeedanceVideoPromptBody(prompt)
  return /^开场状态[：:]/u.test(body)
    && /\nShot\s+1\s*\n/u.test(body)
    && /\nduration:\s*\d+(?:\.\d+)?s(?:\s*\n|$)/u.test(body)
    && /\n镜头[：:]/u.test(body)
    && /\n画面[：:]/u.test(body)
    && /\n光影[：:]/u.test(body)
}

function indexedAssets(assets: SeedancePromptAsset[]): IndexedPromptAsset[] {
  const seenNames = new Set<string>()
  const result: IndexedPromptAsset[] = []

  assets.forEach((asset) => {
    const name = compact(asset.name)
    const key = name.toLocaleLowerCase()
    if (!name || seenNames.has(key)) return
    seenNames.add(key)
    result.push({
      asset: { ...asset, name },
      imageNumber: result.length + 1,
    })
  })

  return result
}

function isAsciiIdentifierChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value))
}

function replaceNamedAssets(
  prompt: string,
  entries: IndexedPromptAsset[],
  replacement: (entry: IndexedPromptAsset) => string,
): string {
  if (!prompt || entries.length === 0) return prompt

  const ordered = [...entries].sort((left, right) => right.asset.name.length - left.asset.name.length)
  const byName = new Map(ordered.map((entry) => [entry.asset.name.toLocaleLowerCase(), entry]))
  const alternatives = ordered.map((entry) => escapeRegExp(entry.asset.name)).join('|')
  const pattern = new RegExp(`@?(${alternatives})`, 'giu')
  const unknownMentions = scanPromptMentions(prompt, ordered.map((entry) => entry.asset.name))
    .filter((mention) => mention.name === null)
  const dialogue = findQuotedDialogueRanges(prompt)
  const boundNameRanges = findBoundNameRanges(prompt)

  return prompt.replace(pattern, (match, rawName: string, offset: number, source: string) => {
    const entry = byName.get(rawName.toLocaleLowerCase())
    if (!entry) return match
    if (isInsideQuotedDialogue(dialogue, offset)) return match
    if (!match.startsWith('@') && boundNameRanges.some((range) => offset >= range.start && offset < range.end)) return match

    if (!match.startsWith('@')) {
      if (!isBareBindableName(rawName)) return match
      if (unknownMentions.some((mention) => offset > mention.start && offset < mention.end)) return match
      const following = source.slice(offset + rawName.length).replace(/^\s+/u, '')
      if (following.toLocaleLowerCase().startsWith(`@${rawName.toLocaleLowerCase()}`)) return match
    }

    if (!match.startsWith('@')) {
      const startsWithAsciiIdentifier = isAsciiIdentifierChar(rawName[0])
      const endsWithAsciiIdentifier = isAsciiIdentifierChar(rawName[rawName.length - 1])
      if (
        (startsWithAsciiIdentifier && isAsciiIdentifierChar(source[offset - 1]))
        || (endsWithAsciiIdentifier && isAsciiIdentifierChar(source[offset + rawName.length]))
      ) {
        return match
      }
    }

    return replacement(entry)
  })
}

function replaceOfficialImageReferences(
  prompt: string,
  entries: IndexedPromptAsset[],
): string {
  let result = prompt

  for (const entry of entries) {
    const boundForm = new RegExp(`@?图(?:片)?\\s*${entry.imageNumber}(?!\\d)（${escapeRegExp(entry.asset.name)}）`, 'gu')
    result = result.replace(boundForm, `@${entry.asset.name}`)
  }

  for (const entry of entries) {
    const imageNumber = entry.imageNumber
    const name = entry.asset.name
    const imageAndName = new RegExp(
      `图片\\s*${imageNumber}(?!\\d)\\s*(?:(?:中|里)的|所示的?)?\\s*${escapeRegExp(name)}`,
      'giu',
    )
    result = result.replace(imageAndName, `@${name}`)
  }

  for (const entry of entries) {
    const imageOnly = new RegExp(`图片\\s*${entry.imageNumber}(?!\\d)`, 'gu')
    result = result.replace(imageOnly, `@${entry.asset.name}`)
  }

  return result
}

export function formatSeedancePromptForEditor(
  prompt: string,
  assets: SeedancePromptAsset[],
): string {
  const entries = indexedAssets(assets)
  const withNamedReferences = replaceOfficialImageReferences(prompt, entries)
  return replaceNamedAssets(withNamedReferences, entries, ({ asset }) => `@${asset.name}`)
}

export function compileSeedancePromptForSubmission(
  prompt: string,
  assets: SeedancePromptAsset[],
  audioNames: readonly string[] = [],
): string {
  const entries = indexedAssets(assets)
  const editorPrompt = formatSeedancePromptForEditor(prompt, assets)
  const body = replaceNamedAssets(editorPrompt, entries, ({ asset, imageNumber }) => (
    `图${imageNumber}（${asset.name}）`
  ))
  const declarations = entries.map(({ asset, imageNumber }) => {
    const kind = asset.kind === 'character' ? '角色' : asset.kind === 'location' ? '场景' : '道具'
    return `图${imageNumber}（@图片${imageNumber}）是${kind}${asset.name}，后文出现 图${imageNumber}（${asset.name}） 时必须始终指代该资产`
  })
  audioNames.map((name) => stripMediaTypeSuffix(compact(name))).filter(Boolean).forEach((name, index) => {
    declarations.push(`音频${index + 1}是角色${name}的声音`)
  })

  return declarations.length > 0 ? `${declarations.join('，')}\n${body}` : body
}

export function stripSeedancePromptAssetMentions(
  prompt: string,
  assets: SeedancePromptAsset[] = [],
): string {
  const entries = indexedAssets(assets)
  const editorPrompt = formatSeedancePromptForEditor(prompt, assets)
  const withoutKnownMentions = replaceNamedAssets(editorPrompt, entries, ({ asset }) => asset.name)
  return withoutKnownMentions.replace(/@(?=[\p{L}\p{N}_])/gu, '')
}

export type SeedanceMentionMediaType = 'image' | 'video' | 'audio'

export interface SeedanceMentionReference {
  type: SeedanceMentionMediaType
  /** 1-based position inside the submitted array of this media type. */
  index: number
  /** Exact names the editor inserted; these win over every fallback. */
  names: string[]
  /** Material titles and other aliases, used only when no primary name claims them. */
  fallbackNames?: string[]
  kind?: SeedancePromptAssetKind
}

export interface SeedanceMentionCompileResult {
  prompt: string
  unresolved: PromptMentionMatch[]
}

const MEDIA_TYPE_ORDER: Record<SeedanceMentionMediaType, number> = { image: 0, video: 1, audio: 2 }

export function compileSeedanceMentionPrompt(
  prompt: string,
  references: readonly SeedanceMentionReference[],
  options: { mediaReferences: boolean },
): SeedanceMentionCompileResult {
  const byName = new Map<string, SeedanceMentionReference>()
  const ordered = [...references].sort((left, right) => (
    MEDIA_TYPE_ORDER[left.type] - MEDIA_TYPE_ORDER[right.type] || left.index - right.index
  ))
  const register = (rawName: string, reference: SeedanceMentionReference) => {
    const key = normalizePromptMentionName(rawName).toLocaleLowerCase()
    if (key && !byName.has(key)) byName.set(key, reference)
  }
  for (const reference of ordered) reference.names.forEach((name) => register(name, reference))
  for (const reference of ordered) (reference.fallbackNames || []).forEach((name) => register(name, reference))

  const dialogue = findQuotedDialogueRanges(prompt)
  const names = ordered.flatMap((reference) => [...reference.names, ...(reference.fallbackNames || [])])
  const mentions = scanPromptMentions(prompt, names)
  const unresolved: PromptMentionMatch[] = []
  const boundReferences = new Set<SeedanceMentionReference>()
  const referenceName = (reference: SeedanceMentionReference): string => (
    stripMediaTypeSuffix(reference.names[0] || reference.fallbackNames?.[0] || '')
    || `${reference.type === 'image' ? '图片' : reference.type === 'video' ? '视频' : '音频'}${reference.index}`
  )
  const bindingFor = (reference: SeedanceMentionReference, displayName: string): string => (
    reference.type === 'image'
      ? `图${reference.index}（${displayName}）`
      : `${reference.type === 'video' ? '视频' : '音频'}${reference.index}`
  )

  let compiled = ''
  let cursor = 0
  for (const mention of mentions) {
    if (isInsideQuotedDialogue(dialogue, mention.start)) continue
    const reference = mention.name === null ? null : byName.get(mention.name.toLocaleLowerCase())
    if (!reference) {
      unresolved.push(mention)
      continue
    }
    compiled += prompt.slice(cursor, mention.start)
    compiled += options.mediaReferences ? bindingFor(reference, mention.text) : mention.text
    if (options.mediaReferences) boundReferences.add(reference)
    cursor = mention.end
  }
  compiled += prompt.slice(cursor)

  if (options.mediaReferences) {
    const bareNames = Array.from(new Set(names.map((name) => normalizePromptMentionName(name)).filter(isBareBindableName)))
      .sort((left, right) => right.length - left.length)
    if (bareNames.length > 0) {
      const barePattern = new RegExp(bareNames.map(escapeRegExp).join('|'), 'giu')
      const boundNameRanges = findBoundNameRanges(compiled)
      const unknownRanges = unresolved.map((mention) => ({ start: mention.start, end: mention.end }))
      const bindingRanges: Array<{ start: number; end: number }> = []
      const bindingPattern = /(?:图|视频|音频)\d+（[^（）]*）|(?:视频|音频)\d+/gu
      let bindingMatch: RegExpExecArray | null
      while ((bindingMatch = bindingPattern.exec(compiled)) !== null) {
        bindingRanges.push({ start: bindingMatch.index, end: bindingMatch.index + bindingMatch[0].length })
      }
      compiled = replaceOutsideQuotes(compiled, barePattern, (match, source) => {
        if (boundNameRanges.some((range) => match.index >= range.start && match.index < range.end)) return null
        if (unknownRanges.some((range) => match.index > range.start && match.index < range.end)) return null
        const before = source.slice(0, match.index)
        const trimmedBefore = before.replace(/\s+$/u, '')
        const trailingBinding = bindingRanges.find((range) => range.end === trimmedBefore.length)
        if (trailingBinding && compiled.slice(trailingBinding.start, trailingBinding.end).includes(match[0])) return null
        const reference = byName.get(match[0].toLocaleLowerCase())
        if (!reference) return null
        const following = source.slice(match.index + match[0].length).replace(/^\s+/u, '')
        if (following.toLocaleLowerCase().startsWith(`@${match[0].toLocaleLowerCase()}`)) return null
        const startsAscii = isAsciiIdentifierChar(match[0][0])
        const endsAscii = isAsciiIdentifierChar(match[0][match[0].length - 1])
        if (
          (startsAscii && isAsciiIdentifierChar(source[match.index - 1]))
          || (endsAscii && isAsciiIdentifierChar(source[match.index + match[0].length]))
        ) return null
        boundReferences.add(reference)
        return bindingFor(reference, match[0])
      })
    }
  }

  const declarations = ordered.filter((reference) => (
    options.mediaReferences && (reference.type !== 'image' || boundReferences.has(reference))
  )).map((reference) => {
    const name = referenceName(reference)
    const kind = reference.type === 'audio' ? '音频' : reference.kind === 'location' ? '场景' : reference.kind === 'character' ? '角色' : '资产'
    return reference.type === 'image'
      ? `图${reference.index}（@图片${reference.index}）是${kind}${name}，后文出现 图${reference.index}（${name}） 时必须始终指代该资产`
      : reference.type === 'audio'
        ? `音频${reference.index}是${name}的声音`
        : `视频${reference.index}是参考视频${name}`
  })

  return {
    prompt: declarations.length > 0 ? `${declarations.join('，')}\n${compiled}` : compiled,
    unresolved,
  }
}
