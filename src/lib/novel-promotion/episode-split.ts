import { countWords } from '@/lib/word-count'
import { buildEpisodeFrameOSMetadata, type EpisodeFrameOSMetadata } from './episode-frameos-metadata'
import { parseScriptEpisodes } from './script-format'
import type { Locale } from '@/i18n/routing'

export type EpisodeSplitOutput = {
  number: number
  title: string
  summary: string
  content: string
  wordCount: number
  frameosMetadata?: EpisodeFrameOSMetadata
}

export type EpisodeSplitProgressPayload = Record<string, unknown>

export type SplitNovelIntoEpisodesInput = {
  userId: string
  projectId: string
  content: string
  locale: Locale
  reportProgress?: (progress: number, payload?: EpisodeSplitProgressPayload) => Promise<void>
  assertActive?: (stage: string) => Promise<void>
}

async function noop() {}

function splitByExplicitScriptHeadings(content: string): EpisodeSplitOutput[] {
  const parsed = parseScriptEpisodes(content)
  if (parsed.warnings.some((warning) => warning.code === 'NO_EPISODE_HEADING_DEFAULTED')) {
    throw new Error('未检测到明确分集标题，请在正文中使用“第一集”“第二集”等标题后再导入。')
  }

  return parsed.episodes.map((episode) => {
    const sourceText = episode.sourceText.trim()
    const wordCount = countWords(sourceText)
    const frameosMetadata = buildEpisodeFrameOSMetadata({
      episode_id: episode.id,
      episode_number: episode.episodeNumber,
      status: 'script_heading_split',
      estimatedWords: wordCount,
    })
    return {
      number: episode.episodeNumber,
      title: episode.title || `第${episode.episodeNumber}集`,
      summary: episode.synopsis || '',
      content: sourceText,
      wordCount,
      ...(frameosMetadata ? { frameosMetadata } : {}),
    }
  })
}

export async function splitNovelIntoEpisodes(input: SplitNovelIntoEpisodesInput): Promise<EpisodeSplitOutput[]> {
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (!content || content.length < 100) {
    throw new Error('文本太短，至少需要 100 字')
  }

  const reportProgress = input.reportProgress || noop
  const assertActive = input.assertActive || noop

  await reportProgress(20, {
    stage: 'episode_split_prepare',
    stageLabel: '准备分集参数',
    displayMode: 'detail',
  })
  await assertActive('episode_split_prepare')

  const episodes = splitByExplicitScriptHeadings(content)

  await reportProgress(96, {
    stage: 'episode_split_done',
    stageLabel: '按显式集标题完成分集',
    displayMode: 'detail',
  })

  return episodes
}
