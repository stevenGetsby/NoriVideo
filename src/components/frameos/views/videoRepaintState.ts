export type RepaintRunState = 'setup' | 'submitting' | 'adapting' | 'review' | 'saving' | 'done'
export type RepaintResultMode = 'llm' | 'source_copy'

export interface RepaintSetupValues {
  title: string
  brief: string
  videoCount: number
}

export interface RepaintSetupErrors {
  title?: string
  videos?: string
}

export interface LocalVideoItem {
  id: string
  file: File
  url: string
}

export interface VideoUnderstandingEpisode {
  fileName: string
  model: string
  script: string
  storyboard: string
  text: string
  analysis: Record<string, unknown> | null
  usage: {
    inputTokens: number
    outputTokens: number
  }
  validation: {
    valid: boolean
    errors: string[]
    warnings: string[]
  }
}

export function validateRepaintSetup(values: RepaintSetupValues): RepaintSetupErrors {
  const errors: RepaintSetupErrors = {}
  if (!values.title.trim()) errors.title = '请填写任务名称'
  if (values.videoCount !== 1) errors.videos = '请上传 1 个视频文件；当前一个视频固定作为一集处理'
  return errors
}

export function formatEpisodeScripts(results: Array<Pick<VideoUnderstandingEpisode, 'script'>>): string {
  return results
    .map((result, index) => result.script.trim() || `第${index + 1}集\n\n未生成格式化剧本`)
    .join('\n\n')
}

export function formatEpisodeStoryboards(results: Array<Pick<VideoUnderstandingEpisode, 'storyboard'>>): string {
  return results
    .map((result, index) => result.storyboard.trim() || `第${index + 1}集 · 源分镜\n\n未生成格式化分镜`)
    .join('\n\n')
}
