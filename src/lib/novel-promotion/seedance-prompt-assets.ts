import { createBarePromptNameMatcher, findQuotedDialogueRanges, isBarePromptName, isInsideQuotedDialogue, normalizePromptMentionName, scanPromptMentions, type PromptMentionMatch } from '@/lib/prompt-mentions'

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

/**
 * The canvas @ picker appends a media-type suffix (米娅·图片 / 米娅·音频) to
 * disambiguate same-named materials in the editor. Declarations must name the
 * asset itself (米娅), not the editor label, so the model is not told the
 * character is literally called "米娅·图片". Numbered editor labels such as
 * 剪贴板素材-1·图片2 keep their suffix: it is the only thing distinguishing them.
 * Only an exact trailing ·图片/·音频/·视频 is removed; names like 米娅·图片2 stay.
 */
function stripMediaTypeSuffix(value: string): string {
  return value.replace(/·(?:图片|音频|视频)$/u, '').trim() || value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Names inside an existing 图N（名）/图片N（名）/音频N（名） binding are already
 * bound; rescanning them would nest bindings (图1（图2（名））). The opening
 * marker must sit at a text boundary so 截图1（…） is not mistaken for one.
 */
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

/**
 * Returns the Seedance prompt body shown in the editor and sent to the model.
 * Legacy prompts may contain Segment metadata around the actual prompt; the
 * canonical body always starts at `开场状态：` and excludes UI-only sections.
 */
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

  assets.forEach((asset, index) => {
    const name = compact(asset.name)
    const key = name.toLocaleLowerCase()
    if (!name || seenNames.has(key)) return
    seenNames.add(key)
    result.push({
      asset: { ...asset, name },
      imageNumber: index + 1,
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
    // Quoted dialogue (“” ‘’ 「」 "" '') keeps asset names as spoken text.
    if (isInsideQuotedDialogue(dialogue, offset)) return match
    // A name already inside a 图N（名） binding stays as written.
    if (!match.startsWith('@') && boundNameRanges.some((range) => offset >= range.start && offset < range.end)) return match

    if (!match.startsWith('@')) {
      // Pure-digit / single-character names only bind via explicit @名称.
      if (!isBarePromptName(rawName)) return match
      // "@女主_萧令仪" is an unknown mention; never rewrite the 萧令仪 inside it.
      if (unknownMentions.some((mention) => offset > mention.start && offset < mention.end)) return match
      // "萧令仪@萧令仪" already carries the mention; compiling both duplicates it.
      const following = source.slice(offset + rawName.length).replace(/^\s+/u, '')
      if (following.toLocaleLowerCase().startsWith(`@${rawName.toLocaleLowerCase()}`)) return match
    }

    // Avoid turning the asset name "Ava" into a mention inside an unrelated word.
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

  // Current bound form 图N（名）/ legacy @图片N（名） back to the editor @名.
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

/**
 * Converts stored/legacy prompts into the editor convention used by FrameOS.
 * Asset names remain readable while every bound asset is represented as @资产名.
 */
export function formatSeedancePromptForEditor(
  prompt: string,
  assets: SeedancePromptAsset[],
): string {
  const entries = indexedAssets(assets)
  const withNamedReferences = replaceOfficialImageReferences(prompt, entries)
  return replaceNamedAssets(withNamedReferences, entries, ({ asset }) => `@${asset.name}`)
}

/**
 * Compiles the editor convention into Volcengine's ordered multimodal syntax.
 * The image number is the asset's exact position in the submitted content array.
 */
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

/** Removes UI-only @ markers when the request is not using reference-image mode. */
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
  /** Library aliases are bare-text fallbacks below selected names and titles. */
  aliases?: string[]
  kind?: SeedancePromptAssetKind
}

export interface SeedanceMentionCompileResult {
  prompt: string
  unresolved: PromptMentionMatch[]
}

const MEDIA_TYPE_ORDER: Record<SeedanceMentionMediaType, number> = { image: 0, video: 1, audio: 2 }

/**
 * Compiles explicit `@mentions` AND bare asset names into the bound form
 * 图N（资产名） (视频N/音频N keep their media labels). Conventions follow the
 * 字字动画 Seedance plugin:
 * - declarations read 图N（@图片N）是{角色|场景|资产}名，后文出现 图N（名） 时必须始终指代该资产;
 * - quoted dialogue (“” ‘’ 「」 "" '') is never rewritten;
 * - longest names win so a short name cannot claim part of a longer one;
 * - pure-digit / single-character names only bind via explicit @名称;
 * - replacement is one-pass and non-recursive: written bindings are never rescanned.
 * Unknown @mentions outside dialogue are reported so callers can refuse to send
 * a prompt that points the model at a reference it was never given.
 */
export function compileSeedanceMentionPrompt(
  prompt: string,
  references: readonly SeedanceMentionReference[],
  options: { mediaReferences: boolean },
): SeedanceMentionCompileResult {
  const byName = new Map<string, SeedanceMentionReference>()
  const ordered = [...references].sort((left, right) => (
    MEDIA_TYPE_ORDER[left.type] - MEDIA_TYPE_ORDER[right.type] || left.index - right.index
  ))
  // Explicit @mentions keep the editor-assigned ownership: primary names are
  // registered before any fallback, so a voice whose exact name is 沈娇 keeps
  // @沈娇 even when an image carries 沈娇 as a title fallback.
  const register = (target: Map<string, SeedanceMentionReference>, rawName: string, reference: SeedanceMentionReference) => {
    const key = normalizePromptMentionName(rawName).toLowerCase()
    if (key && !target.has(key)) target.set(key, reference)
  }
  for (const reference of ordered) reference.names.forEach((name) => register(byName, name, reference))
  for (const reference of ordered) (reference.fallbackNames || []).forEach((name) => register(byName, name, reference))
  // Bare prose is a separate index: only image names participate, and image
  // titles own a shared name before any voice/motion title, so the character
  // 沈娇 in body text binds to the character image, never to the voice.
  const byBareName = new Map<string, SeedanceMentionReference>()
  const imageReferences = ordered.filter((reference) => reference.type === 'image')
  const registerBare = (rawName: string, reference: SeedanceMentionReference) => {
    const name = normalizePromptMentionName(rawName)
    const key = name.toLowerCase()
    if (isBarePromptName(name) && !byBareName.has(key)) byBareName.set(key, reference)
  }
  for (const reference of imageReferences) reference.names.forEach((name) => registerBare(name, reference))
  for (const reference of imageReferences) (reference.fallbackNames || []).forEach((name) => registerBare(name, reference))
  const aliases = new Map<string, SeedanceMentionReference | null>()
  for (const reference of imageReferences) {
    for (const rawName of reference.aliases ?? []) {
      const name = normalizePromptMentionName(rawName)
      const key = name.toLowerCase()
      if (!isBarePromptName(name) || byBareName.has(key)) continue
      const previous = aliases.get(key)
      aliases.set(key, previous === undefined || previous === reference ? reference : null)
    }
  }
  for (const [name, reference] of aliases) {
    if (reference) byBareName.set(name, reference)
  }

  const dialogue = findQuotedDialogueRanges(prompt)
  const names = ordered.flatMap((reference) => [...reference.names, ...(reference.fallbackNames || [])])
  const mentions = scanPromptMentions(prompt, names)
  const unresolved: PromptMentionMatch[] = []
  const unknownRanges: Array<{ start: number; end: number }> = []
  const boundReferences = new Set<SeedanceMentionReference>()
  const referenceName = (reference: SeedanceMentionReference): string => (
    stripMediaTypeSuffix(reference.names[0] || reference.fallbackNames?.[0] || '')
    || `${reference.type === 'image' ? '图片' : reference.type === 'video' ? '视频' : '音频'}${reference.index}`
  )
  // The parenthetical keeps the exact written name (米娅·图片 stays distinct
  // from another 米娅 material); only declarations name the asset itself.
  const bindingFor = (reference: SeedanceMentionReference, displayName: string): string => (
    reference.type === 'image'
      ? `图${reference.index}（${displayName}）`
      : `${reference.type === 'video' ? '视频' : '音频'}${reference.index}`
  )

  let compiled = ''
  let cursor = 0
  for (const mention of mentions) {
    // Dialogue quotes shield everything inside them, @markers included.
    if (isInsideQuotedDialogue(dialogue, mention.start)) continue
    const reference = mention.name === null ? null : byName.get(mention.name.toLowerCase())
    if (!reference) {
      unresolved.push(mention)
      // The second pass reads the compiled string, where preceding explicit
      // mentions may already have changed the original offsets.
      const shift = compiled.length - cursor
      unknownRanges.push({ start: mention.start + shift, end: mention.end + shift })
      continue
    }
    compiled += prompt.slice(cursor, mention.start)
    // Frame modes never submit videos/audios, so 视频N/音频N would point at nothing.
    compiled += options.mediaReferences ? bindingFor(reference, mention.text) : mention.text
    if (options.mediaReferences) boundReferences.add(reference)
    cursor = mention.end
  }
  compiled += prompt.slice(cursor)

  // Second pass: bare asset names outside dialogue bind to the same 图N（名） form.
  // Only image names participate: voices/motion clips are whole-file references,
  // so a character name that happens to equal an audio title must stay bound to
  // the character image. Audios/videos bind through explicit @mentions only.
  if (options.mediaReferences && byBareName.size > 0) {
    const findMatches = createBarePromptNameMatcher(compiled)
    const bareMatches = [...byBareName].flatMap(([name, reference]) =>
      Array.from(findMatches(name), (span) => ({ ...span, reference })))
      .sort((left, right) => left.start - right.start || right.end - left.end)
    const boundNameRanges = findBoundNameRanges(compiled)
    // Whole bindings written by the mention pass, to spot redundant echoes.
    const bindingRanges: Array<{ start: number; end: number }> = []
    const bindingPattern = /(?:图|视频|音频)\d+（[^（）]*）|(?:视频|音频)\d+/gu
    let bindingMatch: RegExpExecArray | null
    while ((bindingMatch = bindingPattern.exec(compiled)) !== null) {
      bindingRanges.push({ start: bindingMatch.index, end: bindingMatch.index + bindingMatch[0].length })
    }
    let result = ''
    let position = 0
    for (const { start, end, reference } of bareMatches) {
      if (start < position) continue
      // The name inside an existing binding is already bound; never nest.
      if (boundNameRanges.some((range) => start >= range.start && start < range.end)) continue
      if (unknownRanges.some((range) => start >= range.start && start < range.end)) continue
      // "@米娅·图片 米娅 米娅：…" — a bare name directly echoing the binding
      // before it is redundant; the parenthetical already names the asset.
      const writtenName = compiled.slice(start, end)
      const before = compiled.slice(0, start)
      const trimmedBefore = before.replace(/\s+$/u, '')
      const trailingBinding = bindingRanges.find((range) => range.end === trimmedBefore.length)
      if (trailingBinding && compiled.slice(trailingBinding.start, trailingBinding.end).includes(writtenName)) continue
      // "萧令仪@萧令仪" already carries the mention; binding both duplicates it.
      const following = compiled.slice(end).replace(/^\s+/u, '')
      if (following.toLowerCase().startsWith(`@${writtenName.toLowerCase()}`)) continue
      boundReferences.add(reference)
      result += compiled.slice(position, start) + bindingFor(reference, writtenName)
      position = end
    }
    compiled = result + compiled.slice(position)
  }

  // Audios/videos are attached as whole-file voice/motion references: the model
  // needs to know whose voice 音频N is even when the body only writes the name
  // in prose (音频2 米娅声音参考), so every submitted media reference is declared.
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
