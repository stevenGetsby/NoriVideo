type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readSceneLabel(scene: JsonRecord, index: number): string {
  const sceneNumber = typeof scene.scene_number === 'number'
    ? scene.scene_number
    : index + 1
  const heading = asRecord(scene.heading)
  const location = readText(heading?.location) || readText(scene.location)
  const time = readText(heading?.time) || readText(scene.time)
  const headingText = [location, time].filter(Boolean).join(' ')
  return headingText ? `Scene ${sceneNumber} (${headingText})` : `Scene ${sceneNumber}`
}

export function buildScreenplayVisualStyleContext(screenplay: unknown): string {
  const record = asRecord(screenplay)
  if (!record) return 'No explicit screenplay visual style context.'

  const lines: string[] = []
  const defaultVisualStyle = asRecord(record.default_visual_style)
  if (defaultVisualStyle) {
    const name = readText(defaultVisualStyle.name)
    const description = readText(defaultVisualStyle.description)
    if (name || description) {
      lines.push(`Default visual style: ${[name, description].filter(Boolean).join(' - ')}`)
    }
  }

  const scenes = Array.isArray(record.scenes)
    ? record.scenes.filter((item): item is JsonRecord => !!item && typeof item === 'object' && !Array.isArray(item))
    : []
  scenes.forEach((scene, index) => {
    const visualStyle = readText(scene.visual_style)
    const visualStyleDescription = readText(scene.visual_style_description)
    if (!visualStyle && !visualStyleDescription) return
    const parts = [
      visualStyle ? `visual_style=${visualStyle}` : '',
      visualStyleDescription ? `visual_style_description=${visualStyleDescription}` : '',
    ].filter(Boolean)
    lines.push(`${readSceneLabel(scene, index)}: ${parts.join('; ')}`)
  })

  return lines.length > 0 ? lines.join('\n') : 'No explicit screenplay visual style context.'
}
