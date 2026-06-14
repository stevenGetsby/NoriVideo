export type StandardScriptPackageVersion = 'standard-script-v1'

export type StandardScriptWarningCode =
  | 'TEXT_EMPTY'
  | 'SECTION_MISSING'
  | 'CHARACTER_LINE_UNPARSED'
  | 'EPISODE_BODY_EMPTY'
  | 'LLM_REPAIR_USED'

export type StandardScriptSource = {
  fileName?: string
  rawTextLength: number
  normalizedText: string
}

export type StandardScriptCharacter = {
  id: string
  name: string
  description: string
  aliases: string[]
}

export type StandardScriptEpisode = {
  id: string
  episodeNumber: number
  title: string
  sourceText: string
  synopsis?: string
}

export type StandardScriptWarning = {
  code: StandardScriptWarningCode
  message: string
  targetId?: string
}

export type StandardScriptPackage = {
  version: StandardScriptPackageVersion
  source: StandardScriptSource
  storyBrief: string
  characters: StandardScriptCharacter[]
  episodes: StandardScriptEpisode[]
  warnings: StandardScriptWarning[]
}

export type StandardScriptParseErrorCode =
  | 'TEXT_EMPTY'
  | 'STORY_BRIEF_MISSING'
  | 'CHARACTERS_MISSING'
  | 'EPISODES_MISSING'
  | 'NO_VALID_EPISODES'
  | 'PACKAGE_INVALID'

export class StandardScriptParseError extends Error {
  code: StandardScriptParseErrorCode

  constructor(code: StandardScriptParseErrorCode, message: string) {
    super(message)
    this.name = 'StandardScriptParseError'
    this.code = code
  }
}

export type ParseStandardScriptOptions = {
  fileName?: string
  mode?: 'strict' | 'relaxed'
}
