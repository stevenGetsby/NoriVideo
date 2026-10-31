import sharp from 'sharp'
import { callVisionModel } from '@/lib/model-api'
import { getCompletionContent } from '@/lib/llm/completion-parts'
import type { PreparedStyleReference } from './style-reference-upload'

export const PROJECT_STYLE_ANALYSIS_MAX_IMAGE_BYTES = 20 * 1024 * 1024

export const PROJECT_STYLE_ANALYSIS_PROMPT = [
  '你是 LanMiaoTV 的影视美术指导。请分析所附参考图片，提炼一段可直接用于整部短剧资产图、分镜图和视频生成的统一中文画风提示词。',
  '只提炼可迁移的视觉风格，不复述具体人物身份、剧情、品牌、IP、画中文字或水印。',
  '覆盖：媒介与渲染方式、角色造型倾向、线条或材质、色彩系统、光影与对比、镜头与景深、细节密度、时代/地域美术气质、跨镜一致性，以及应避免的风格漂移。',
  '多张图片存在差异时提炼它们的稳定交集；不要臆造参考图中不存在的风格特征。',
  '输出 180–360 个中文字符的单段纯文本，不要标题、列表、Markdown、引号或解释。',
].join('\n')

async function toVisionDataUrl(reference: PreparedStyleReference): Promise<string> {
  const normalized = await sharp(reference.body)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({
      width: 1536,
      height: 1536,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
  return `data:image/jpeg;base64,${normalized.toString('base64')}`
}

export function normalizeProjectStyleAnalysisText(value: string): string {
  const normalized = value
    .replace(/^```(?:text|plaintext|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^画风提示词\s*[：:]\s*/i, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return Array.from(normalized).slice(0, 5000).join('')
}

export async function analyzeProjectStyleReferenceImages(input: {
  userId: string
  modelKey: string
  references: PreparedStyleReference[]
}): Promise<string> {
  const images = input.references.filter((reference) => reference.kind === 'image')
  if (images.length === 0) throw new Error('STYLE_REFERENCE_IMAGE_REQUIRED')
  const imageUrls = await Promise.all(images.map(toVisionDataUrl))
  const completion = await callVisionModel({
    userId: input.userId,
    modelKey: input.modelKey,
    prompt: PROJECT_STYLE_ANALYSIS_PROMPT,
    imageUrls,
    options: {
      temperature: 0.2,
      reasoning: false,
      maxRetries: 1,
      action: 'project-style-reference-analysis',
    },
  })
  const prompt = normalizeProjectStyleAnalysisText(getCompletionContent(completion))
  if (prompt.length < 20) throw new Error('STYLE_REFERENCE_ANALYSIS_EMPTY')
  return prompt
}
