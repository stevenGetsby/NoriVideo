type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function displayAssetName(
  asset: JsonRecord,
  kind: 'character' | 'location' | 'prop',
  index: number,
  unnamedCharacterIndex: number,
): string {
  const explicitName = kind === 'character'
    ? asString(asset.name_if_heard)
    : asString(asset.name_if_known)
  if (explicitName) return explicitName
  if (kind === 'character') {
    const role = asString(asset.role_function)
    const roleLabel = role.includes('随从') ? '随从' : role.includes('打手') ? '打手' : '角色'
    const suffix = ['甲', '乙', '丙', '丁'][unnamedCharacterIndex] || String(unnamedCharacterIndex + 1)
    return `${roleLabel}${suffix}`
  }
  const assetRef = asString(asset.asset_ref)
  return assetRef || `${kind}_${index + 1}`
}

function buildAssetNames(assets: JsonRecord): Map<string, string> {
  const names = new Map<string, string>()
  let unnamedCharacterCount = 0
  const groups = [
    ['characters', 'character'],
    ['locations', 'location'],
    ['props', 'prop'],
  ] as const
  for (const [field, kind] of groups) {
    asArray(assets[field]).forEach((value, index) => {
      const asset = asRecord(value)
      const assetRef = asString(asset.asset_ref)
      const isUnnamedCharacter = kind === 'character' && !asString(asset.name_if_heard)
      if (assetRef) names.set(assetRef, displayAssetName(asset, kind, index, unnamedCharacterCount))
      if (isUnnamedCharacter) unnamedCharacterCount += 1
    })
  }
  return names
}

function assetMention(assetRef: unknown, names: Map<string, string>): string {
  const ref = asString(assetRef)
  return ref ? `@${names.get(ref) || ref}` : ''
}

function joinLine(label: string, values: unknown[]): string {
  const content = values.map(asString).filter(Boolean).join('、')
  return content ? `${label}：${content}` : ''
}

function dialogueText(value: unknown, names: Map<string, string>): string {
  if (typeof value === 'string') return value.trim()
  const dialogue = asRecord(value)
  const text = asString(dialogue.text)
  if (!text) return ''
  const speaker = assetMention(dialogue.speaker_ref, names)
  return speaker ? `${speaker}：${text}` : text
}

export function formatSourceStoryboard(input: unknown): string {
  if (!isRecord(input)) return ''
  const episode = asRecord(input.source_episode)
  const storyboard = asRecord(input.source_storyboard)
  const shots = asArray(storyboard.shots).map(asRecord)
  if (!shots.length) return ''

  const episodeNumber = asNumber(episode.episode_number) ?? 1
  const scenes = new Map<string, JsonRecord>()
  for (const value of asArray(episode.scenes)) {
    const scene = asRecord(value)
    const sceneId = asString(scene.scene_id)
    if (sceneId) scenes.set(sceneId, scene)
  }
  const assetNames = buildAssetNames(asRecord(input.asset_candidates))
  const lines = [`第${episodeNumber}集 · 源分镜`, `共 ${shots.length} 镜`]

  shots.forEach((shot, index) => {
    const panelNumber = asNumber(shot.panel_number) ?? index + 1
    const panelId = asString(shot.panel_id) || `P${String(panelNumber).padStart(3, '0')}`
    const anchor = asRecord(shot.source_anchor)
    const startTime = asString(anchor.start_time)
    const endTime = asString(anchor.end_time)
    const duration = asNumber(shot.duration_seconds)
    const scene = scenes.get(asString(shot.scene_id)) || {}
    const heading = asRecord(scene.heading)
    const sceneLabel = [
      asString(scene.scene_number),
      asString(heading.location),
      asString(heading.time_of_day),
    ].filter(Boolean).join(' · ')
    const camera = [
      asString(shot.shot_size),
      asString(shot.camera_angle),
      asString(shot.camera_movement),
      asString(shot.lens_or_fov),
    ].filter(Boolean).join('，')
    const refs = asRecord(shot.referenced_assets)
    const assetRefs = [
      ...asArray(refs.characters),
      refs.location,
      ...asArray(refs.props),
    ]
    const mentionedAssets = [...new Set(assetRefs.map((ref) => assetMention(ref, assetNames)).filter(Boolean))]

    lines.push('', `Shot ${panelNumber} · ${panelId}`)
    if (duration !== null) lines.push(`duration: ${duration}s`)
    if (startTime || endTime) lines.push(`时间码：${startTime || '?'} → ${endTime || '?'}`)
    if (sceneLabel) lines.push(`场次：${sceneLabel}`)
    if (camera) lines.push(`镜头：${camera}`)
    if (asString(shot.composition)) lines.push(`构图：${asString(shot.composition)}`)
    if (asString(shot.description)) lines.push(`画面：${asString(shot.description)}`)
    if (asString(shot.action)) lines.push(`动作：${asString(shot.action)}`)
    const dialogueLine = joinLine('对白', asArray(shot.dialogue).map((value) => dialogueText(value, assetNames)))
    if (dialogueLine) lines.push(dialogueLine)
    if (asString(shot.sound)) lines.push(`声音：${asString(shot.sound)}`)
    if (asString(shot.lighting)) lines.push(`光影：${asString(shot.lighting)}`)
    if (asString(shot.transition)) lines.push(`转场：${asString(shot.transition)}`)
    if (mentionedAssets.length) lines.push(`资产：${mentionedAssets.join('、')}`)
    if (asString(shot.continuity_notes)) lines.push(`连续性：${asString(shot.continuity_notes)}`)
  })

  return lines.join('\n')
}
