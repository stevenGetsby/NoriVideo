export const DEFAULT_VIDEO_EXPORT_TEMPLATE = '{project}_{generation}_视频{sequence}_{creator}'
export const VIDEO_EXPORT_TOKENS = ['project', 'episode', 'sequence', 'generation', 'creator', 'attempt'] as const

export function validateVideoExportTemplate(value: string): boolean {
  return value.length <= 191 && !/[\\/\u0000-\u001f]/.test(value)
    && !/[{}]/.test(value.replace(/\{(project|episode|sequence|generation|creator|attempt)\}/g, ''))
}

function cleanPart(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return [...(text.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim() || fallback)].slice(0, 32).join('')
}

export function buildNovelVideoExportFileName(input: {
  projectName?: string | null
  episodeName?: string | null
  sequence: number
  generationName?: string | null
  creatorName?: string | null
  template?: string | null
  generationIndex?: number | null
}): string {
  const project = cleanPart(input.projectName, '项目')
  const episode = cleanPart(input.episodeName, '剧集')
  const sequence = Number.isFinite(input.sequence) ? Math.max(1, Math.floor(input.sequence)) : 1
  const generation = cleanPart(input.generationName, `${String(sequence).padStart(3, '0')}镜头组`)
  const creator = cleanPart(input.creatorName, '未命名账号')
  const sequenceText = String(sequence).padStart(3, '0')
  const template = input.template?.trim() || DEFAULT_VIDEO_EXPORT_TEMPLATE
  const attempt = typeof input.generationIndex === 'number' && Number.isSafeInteger(input.generationIndex) && input.generationIndex > 0
    ? String(input.generationIndex).padStart(3, '0') : '未记录'
  const rendered = template.replace(/\{(project|episode|sequence|generation|creator|attempt)\}/g, (_match, token: string) => ({
    project,
    episode,
    sequence: sequenceText,
    generation,
    creator,
    attempt,
  }[token] || ''))
  // Do not truncate the complete name: that used to remove the creator suffix
  // and could collapse two outputs into one file. Limit individual parts and
  // fall back to a short identity-preserving layout for oversized templates.
  const safe = rendered.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/[. ]+$/g, '')
  const short = (part: string) => [...part].slice(0, 16).join('')
  const fallback = `${short(project)}_${short(generation)}_视频${sequenceText}_${short(creator)}`
  const file = new TextEncoder().encode(safe).length <= 240 ? safe : fallback
  return `${file || fallback}.mp4`
}
