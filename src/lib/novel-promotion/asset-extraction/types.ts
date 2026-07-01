export type AssetExtractionPackageVersion = 'asset-extraction-v1'

export type CharacterImportance = 'lead' | 'core_supporting' | 'supporting'

export type SourceEvidence = {
  episodeNumber: number
  quote: string
}

export type CharacterVisualProfile = {
  subject: string
  face: string
  clothing: string
  accessories: string
}

export type CharacterPeriodFacts = {
  identity: string
  socialStatus: string
  plotState: string
  explicitVisualCues: string[]
}

export type CharacterVariant = {
  id: string
  name: string
  episodeRange: {
    start: number
    end: number
  }
  facts: CharacterPeriodFacts
  backgroundDelta: string
  profileOverride: Partial<CharacterVisualProfile>
  reason: string
  evidence: SourceEvidence[]
}

export type CharacterMainAppearance = {
  id: string
  name: string
  episodeRange: {
    start: number
    end: number
  }
  facts: CharacterPeriodFacts
  profile: CharacterVisualProfile
  reason: string
  evidence: SourceEvidence[]
}

export type CharacterAsset = {
  id: string
  name: string
  aliases: string[]
  importance: CharacterImportance
  background: string
  mainAppearance: CharacterMainAppearance
  /** Backward-compatible copy of mainAppearance.profile. */
  profile: CharacterVisualProfile
  variants: CharacterVariant[]
  relatedEpisodes: number[]
  evidence: SourceEvidence[]
}

export type EnvironmentAsset = {
  id: string
  name: string
  background: string
  profile: {
    subject: string
    layout: string
    atmosphere: string
    visualDetails: string
  }
  relatedEpisodes: number[]
  evidence: SourceEvidence[]
}

export type PropAsset = {
  id: string
  name: string
  background: string
  profile: {
    subject: string
    material: string
    shape: string
    visualDetails: string
  }
  owner?: string
  relatedEpisodes: number[]
  evidence: SourceEvidence[]
}

export type ExtractionWarning = {
  code: 'EMPTY_SECTION' | 'LOW_CONFIDENCE' | 'NORMALIZED_FIELD'
  message: string
  targetId?: string
}

export type AssetExtractionEpisodeInput = {
  episodeNumber: number
  title: string
  sourceText: string
}

export type AssetExtractionPackage = {
  version: AssetExtractionPackageVersion
  worldBackground: string
  characters: CharacterAsset[]
  environments: EnvironmentAsset[]
  props: PropAsset[]
  warnings: ExtractionWarning[]
}

export type ExecuteAssetExtractionInput = {
  userId: string
  projectId: string
  model: string
  episodes: AssetExtractionEpisodeInput[]
}
