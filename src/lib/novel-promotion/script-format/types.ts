export type EpisodeSplitPackageVersion = 'episode-split-v1'

export type EpisodeSplitWarningCode =
  | 'NO_EPISODE_HEADING_DEFAULTED'
  | 'EPISODE_BODY_EMPTY'

export type EpisodeSplitSource = {
  fileName?: string
  rawTextLength: number
  normalizedText: string
}

export type ParsedScriptEpisode = {
  id: string
  episodeNumber: number
  title: string
  sourceText: string
  synopsis?: string
}

export type EpisodeSplitWarning = {
  code: EpisodeSplitWarningCode
  message: string
  targetId?: string
}

export type EpisodeSplitPackage = {
  version: EpisodeSplitPackageVersion
  source: EpisodeSplitSource
  episodes: ParsedScriptEpisode[]
  warnings: EpisodeSplitWarning[]
}

export type EpisodeSplitParseErrorCode = 'TEXT_EMPTY'

export class EpisodeSplitParseError extends Error {
  code: EpisodeSplitParseErrorCode

  constructor(code: EpisodeSplitParseErrorCode, message: string) {
    super(message)
    this.name = 'EpisodeSplitParseError'
    this.code = code
  }
}

export type ParseScriptEpisodesOptions = {
  fileName?: string
}
