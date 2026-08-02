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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

  return prompt.replace(pattern, (match, rawName: string, offset: number, source: string) => {
    const entry = byName.get(rawName.toLocaleLowerCase())
    if (!entry) return match

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
): string {
  const entries = indexedAssets(assets)
  const editorPrompt = formatSeedancePromptForEditor(prompt, assets)

  return replaceNamedAssets(editorPrompt, entries, ({ asset, imageNumber }) => (
    asset.kind === 'location'
      ? `图片${imageNumber}所示的${asset.name}`
      : `图片${imageNumber}中的${asset.name}`
  ))
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
