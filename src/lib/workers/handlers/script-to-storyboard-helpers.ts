import { safeParseJson, safeParseJsonArray } from '@/lib/json-repair'
import { prisma } from '@/lib/prisma'
import type { StoryboardPanel } from '@/lib/storyboard-phases'
import {
  buildPanelSeedanceReferenceAssets,
  writePanelSeedanceReferenceAssetsToActingNotes,
} from '@/lib/novel-promotion/seedance-reference-assets'
import {
  buildPanelFrameOSMetadata,
  readActingNotesContinuityText,
  readPanelFrameOSMetadataFromActingNotes,
  writePanelFrameOSMetadataToActingNotes,
} from '@/lib/novel-promotion/panel-frameos-metadata'

export type JsonRecord = Record<string, unknown>

export type ClipPanelsResult = {
  clipId: string
  clipIndex: number
  finalPanels: StoryboardPanel[]
}

export type PersistedStoryboard = {
  storyboardId: string
  clipId: string
  panels: Array<{
    id: string
    panelIndex: number
    panelNumber?: number | null
    shotType?: string | null
    cameraMove?: string | null
    description: string | null
    location?: string | null
    srtSegment: string | null
    characters: string | null
    props: string | null
    duration?: number | null
    imagePrompt?: string | null
    videoPrompt?: string | null
    photographyRules?: string | null
    actingNotes?: string | null
    sceneType?: string | null
  }>
}

export function parseEffort(value: unknown): 'minimal' | 'low' | 'medium' | 'high' | null {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') return value
  return null
}

export function parseTemperature(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.7
  return Math.max(0, Math.min(2, value))
}

export function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const n = Math.floor(value)
  return n >= 0 ? n : null
}

function parsePanelCharacters(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean)
  } catch {
    return []
  }
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => (typeof item === 'string' ? item : '')).filter(Boolean)
  } catch {
    return []
  }
}

function readPanelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (typeof item === 'object' && item !== null) {
        const record = item as JsonRecord
        return typeof record.name === 'string' ? record.name.trim() : ''
      }
      return ''
    })
    .filter(Boolean)
}

function buildContinuityNotes(...items: Array<unknown>): string {
  return items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('\n')
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseVoiceLinesJson(responseText: string): JsonRecord[] {
  const rows = safeParseJsonArray(responseText)
  if (rows.length === 0) {
    const raw = safeParseJson(responseText)
    if (Array.isArray(raw) && raw.length === 0) {
      return []
    }
    throw new Error('voice_analyze: invalid payload')
  }
  return rows as JsonRecord[]
}

export function asJsonRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : null
}

export function buildStoryboardJson(storyboards: PersistedStoryboard[]) {
  const rows: Array<{
    storyboardId: string
    panelIndex: number
    panel_id: string
    panel_number: number
    text_segment: string
    source_text: string
    source_anchor: unknown
    description: string
    location: string
    characters: string[]
    props: string[]
    referenced_assets: unknown
    scene_type: string
    shot_type: string
    camera_move: string
    image_prompt: string
    visual_prompt: string
    video_prompt: string
    visual_style: string
    visual_style_description: string
    continuity_notes: string
    voice_refs: unknown
    duration: number | null
  }> = []

  for (const storyboard of storyboards) {
    for (const panel of storyboard.panels) {
      const textSegment = panel.srtSegment || ''
      const characters = parsePanelCharacters(panel.characters)
      const props = parseStringArray(panel.props)
      const location = panel.location || ''
      const metadata = readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)
      const sourceText = typeof metadata?.source_text === 'string' && metadata.source_text.trim()
        ? metadata.source_text
        : textSegment
      const referencedAssets = metadata?.referenced_assets ?? {
        characters,
        location,
        props,
      }
      rows.push({
        storyboardId: storyboard.storyboardId,
        panelIndex: panel.panelIndex,
        panel_id: metadata?.panel_id || panel.id,
        panel_number: typeof metadata?.panel_number === 'number'
          ? metadata.panel_number
          : typeof panel.panelNumber === 'number'
            ? panel.panelNumber
            : panel.panelIndex + 1,
        text_segment: textSegment,
        source_text: sourceText,
        source_anchor: metadata?.source_anchor ?? (sourceText ? { text: sourceText } : null),
        description: panel.description || '',
        location,
        characters,
        props,
        referenced_assets: referencedAssets,
        scene_type: panel.sceneType || '',
        shot_type: panel.shotType || '',
        camera_move: panel.cameraMove || '',
        image_prompt: panel.imagePrompt || '',
        visual_prompt: metadata?.visual_prompt || panel.imagePrompt || '',
        video_prompt: panel.videoPrompt || '',
        visual_style: metadata?.visual_style || '',
        visual_style_description: metadata?.visual_style_description || '',
        continuity_notes: buildContinuityNotes(
          metadata?.continuity_notes,
          panel.photographyRules,
          readActingNotesContinuityText(panel.actingNotes),
        ),
        voice_refs: metadata?.voice_refs || [],
        duration: typeof panel.duration === 'number' ? panel.duration : null,
      })
    }
  }

  if (rows.length === 0) return '无分镜数据'
  return JSON.stringify(rows, null, 2)
}

export function buildStoryboardJsonFromClipPanels(clipPanels: ClipPanelsResult[]) {
  const rows: Array<{
    storyboardId: string
    panelIndex: number
    panel_id: string
    panel_number: number
    text_segment: string
    source_text: string
    source_anchor: unknown
    description: string
    characters: string[]
    location: string
    props: string[]
    referenced_assets: unknown
    scene_type: string
    shot_type: string
    camera_move: string
    image_prompt: string
    visual_prompt: string
    video_prompt: string
    continuity_notes: string
    voice_refs: unknown
    duration: number | null
  }> = []

  for (const clipEntry of clipPanels) {
    for (let index = 0; index < clipEntry.finalPanels.length; index += 1) {
      const panel = clipEntry.finalPanels[index]
      const textSegment = panel.source_text || ''
      const characters = readPanelNames(panel.characters)
      const props = Array.isArray(panel.props) ? panel.props.filter((item): item is string => typeof item === 'string' && Boolean(item)) : []
      const location = panel.location || ''
      rows.push({
        storyboardId: clipEntry.clipId,
        panelIndex: index,
        panel_id: panel.panel_id || `${clipEntry.clipId}:${index}`,
        panel_number: isNumber(panel.panel_number) ? panel.panel_number : index + 1,
        text_segment: textSegment,
        source_text: textSegment,
        source_anchor: panel.source_anchor ?? (textSegment ? { text: textSegment } : null),
        description: panel.description || '',
        characters,
        location,
        props,
        referenced_assets: panel.referenced_assets ?? {
          characters,
          location,
          props,
        },
        scene_type: panel.scene_type || '',
        shot_type: panel.shot_type || '',
        camera_move: panel.camera_move || '',
        image_prompt: panel.image_prompt || '',
        visual_prompt: panel.visual_prompt || '',
        video_prompt: panel.video_prompt || '',
        continuity_notes: buildContinuityNotes(panel.continuity_notes, panel.photographyPlan, panel.actingNotes),
        voice_refs: panel.voice_refs || [],
        duration: isNumber(panel.duration) ? panel.duration : null,
      })
    }
  }

  if (rows.length === 0) return '无分镜数据'
  return JSON.stringify(rows, null, 2)
}

async function resolvePanelReferenceProjectAssets(episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: { novelPromotionProjectId: true },
  })
  if (!episode) return null

  return await prisma.novelPromotionProject.findUnique({
    where: { id: episode.novelPromotionProjectId },
    include: {
      characters: {
        include: {
          appearances: { orderBy: { appearanceIndex: 'asc' } },
        },
      },
      locations: {
        include: {
          selectedImage: true,
          images: { orderBy: { imageIndex: 'asc' } },
        },
      },
    },
  })
}

export async function persistStoryboardsAndPanels(params: {
  episodeId: string
  clipPanels: ClipPanelsResult[]
}) {
  const { episodeId, clipPanels } = params
  type PanelRow = {
    id: string
    panelIndex: number
    panelNumber: number | null
    shotType: string | null
    cameraMove: string | null
    description: string | null
    location: string | null
    srtSegment: string | null
    characters: string | null
    props: string | null
    duration: number | null
    imagePrompt: string | null
    videoPrompt: string | null
    photographyRules: string | null
    actingNotes: string | null
    sceneType: string | null
  }
  const projectAssets = await resolvePanelReferenceProjectAssets(episodeId)
  return await prisma.$transaction(async (tx) => {
    const persisted: PersistedStoryboard[] = []
    for (const clipEntry of clipPanels) {
      const storyboard = await tx.novelPromotionStoryboard.upsert({
        where: { clipId: clipEntry.clipId },
        create: {
          clipId: clipEntry.clipId,
          episodeId,
          panelCount: clipEntry.finalPanels.length,
        },
        update: {
          panelCount: clipEntry.finalPanels.length,
          episodeId,
          lastError: null,
        },
        select: { id: true, clipId: true },
      })

      await tx.novelPromotionPanel.deleteMany({
        where: { storyboardId: storyboard.id },
      })

      const panelModel = tx.novelPromotionPanel as unknown as {
        create: (args: {
          data: Record<string, unknown>
          select: {
            id: true
            panelIndex: true
            panelNumber: true
            shotType: true
            cameraMove: true
            description: true
            location: true
            srtSegment: true
            characters: true
            props: true
            duration: true
            imagePrompt: true
            videoPrompt: true
            photographyRules: true
            actingNotes: true
            sceneType: true
          }
        }) => Promise<PanelRow>
      }
      const persistedPanels: PersistedStoryboard['panels'] = []
      for (let i = 0; i < clipEntry.finalPanels.length; i += 1) {
        const panel = clipEntry.finalPanels[i]
        const seedanceReferenceAssets = projectAssets
          ? buildPanelSeedanceReferenceAssets({
            panel: {
              characters: panel.characters,
              location: panel.location,
              props: panel.props,
              videoPrompt: panel.video_prompt,
            },
            characterAssets: projectAssets.characters,
            locationAssets: projectAssets.locations,
          })
          : []
        const actingNotes = writePanelSeedanceReferenceAssetsToActingNotes(
          writePanelFrameOSMetadataToActingNotes(
            panel.actingNotes || null,
            buildPanelFrameOSMetadata({
              panel_id: panel.panel_id,
              panel_number: panel.panel_number || i + 1,
              source_text: panel.source_text,
              source_anchor: panel.source_anchor,
              referenced_assets: panel.referenced_assets,
              visual_prompt: panel.visual_prompt,
              visual_style: panel.visual_style,
              visual_style_description: panel.visual_style_description,
              continuity_notes: panel.continuity_notes,
              voice_refs: panel.voice_refs,
            }),
          ),
          seedanceReferenceAssets,
        )
        const created = await panelModel.create({
          data: {
            storyboardId: storyboard.id,
            panelIndex: i,
            panelNumber: panel.panel_number || i + 1,
            shotType: panel.shot_type || '中景',
            cameraMove: panel.camera_move || '固定',
            description: panel.description || null,
            imagePrompt: panel.image_prompt || panel.visual_prompt || null,
            videoPrompt: panel.video_prompt || null,
            location: panel.location || null,
            characters: panel.characters ? JSON.stringify(panel.characters) : null,
            props: panel.props ? JSON.stringify(panel.props) : null,
            srtSegment: panel.source_text || null,
            photographyRules: panel.photographyPlan ? JSON.stringify(panel.photographyPlan) : null,
            actingNotes,
            duration: panel.duration || null,
          },
          select: {
            id: true,
            panelIndex: true,
            panelNumber: true,
            shotType: true,
            cameraMove: true,
            description: true,
            location: true,
            srtSegment: true,
            characters: true,
            props: true,
            duration: true,
            imagePrompt: true,
            videoPrompt: true,
            photographyRules: true,
            actingNotes: true,
            sceneType: true,
          },
        })
        persistedPanels.push(created)
      }

      persisted.push({
        storyboardId: storyboard.id,
        clipId: storyboard.clipId,
        panels: persistedPanels,
      })
    }
    return persisted
  }, { timeout: 30000 })
}

export async function persistStoryboardOutputs(params: {
  episodeId: string
  clipPanels: ClipPanelsResult[]
  voiceLineRows: JsonRecord[] | null
}) {
  const projectAssets = await resolvePanelReferenceProjectAssets(params.episodeId)
  const persistedStoryboards = await prisma.$transaction(async (tx) => {
    const persisted: PersistedStoryboard[] = []
    const panelIdByStoryboardRef = new Map<string, string>()
    const storyboardIdByRef = new Map<string, string>()

    for (const clipEntry of params.clipPanels) {
      const storyboard = await tx.novelPromotionStoryboard.upsert({
        where: { clipId: clipEntry.clipId },
        create: {
          clipId: clipEntry.clipId,
          episodeId: params.episodeId,
          panelCount: clipEntry.finalPanels.length,
        },
        update: {
          panelCount: clipEntry.finalPanels.length,
          episodeId: params.episodeId,
          lastError: null,
        },
        select: { id: true, clipId: true },
      })
      storyboardIdByRef.set(storyboard.id, storyboard.id)
      storyboardIdByRef.set(clipEntry.clipId, storyboard.id)

      await tx.novelPromotionPanel.deleteMany({
        where: { storyboardId: storyboard.id },
      })

      const panelModel = tx.novelPromotionPanel as unknown as {
        create: (args: {
          data: Record<string, unknown>
          select: {
            id: true
            panelIndex: true
            panelNumber: true
            shotType: true
            cameraMove: true
            description: true
            location: true
            srtSegment: true
            characters: true
            props: true
            duration: true
            imagePrompt: true
            videoPrompt: true
            photographyRules: true
            actingNotes: true
            sceneType: true
          }
        }) => Promise<{
          id: string
          panelIndex: number
          panelNumber: number | null
          shotType: string | null
          cameraMove: string | null
          description: string | null
          location: string | null
          srtSegment: string | null
          characters: string | null
          props: string | null
          duration: number | null
          imagePrompt: string | null
          videoPrompt: string | null
          photographyRules: string | null
          actingNotes: string | null
          sceneType: string | null
        }>
      }
      const persistedPanels: PersistedStoryboard['panels'] = []
      for (let i = 0; i < clipEntry.finalPanels.length; i += 1) {
        const panel = clipEntry.finalPanels[i]
        const seedanceReferenceAssets = projectAssets
          ? buildPanelSeedanceReferenceAssets({
            panel: {
              characters: panel.characters,
              location: panel.location,
              props: panel.props,
              videoPrompt: panel.video_prompt,
            },
            characterAssets: projectAssets.characters,
            locationAssets: projectAssets.locations,
          })
          : []
        const actingNotes = writePanelSeedanceReferenceAssetsToActingNotes(
          writePanelFrameOSMetadataToActingNotes(
            panel.actingNotes || null,
            buildPanelFrameOSMetadata({
              panel_id: panel.panel_id,
              panel_number: panel.panel_number || i + 1,
              source_text: panel.source_text,
              source_anchor: panel.source_anchor,
              referenced_assets: panel.referenced_assets,
              visual_prompt: panel.visual_prompt,
              visual_style: panel.visual_style,
              visual_style_description: panel.visual_style_description,
              continuity_notes: panel.continuity_notes,
              voice_refs: panel.voice_refs,
            }),
          ),
          seedanceReferenceAssets,
        )
        const created = await panelModel.create({
          data: {
            storyboardId: storyboard.id,
            panelIndex: i,
            panelNumber: panel.panel_number || i + 1,
            shotType: panel.shot_type || '中景',
            cameraMove: panel.camera_move || '固定',
            description: panel.description || null,
            imagePrompt: panel.image_prompt || panel.visual_prompt || null,
            videoPrompt: panel.video_prompt || null,
            location: panel.location || null,
            characters: panel.characters ? JSON.stringify(panel.characters) : null,
            props: panel.props ? JSON.stringify(panel.props) : null,
            srtSegment: panel.source_text || null,
            photographyRules: panel.photographyPlan ? JSON.stringify(panel.photographyPlan) : null,
            actingNotes,
            duration: panel.duration || null,
          },
          select: {
            id: true,
            panelIndex: true,
            panelNumber: true,
            shotType: true,
            cameraMove: true,
            description: true,
            location: true,
            srtSegment: true,
            characters: true,
            props: true,
            duration: true,
            imagePrompt: true,
            videoPrompt: true,
            photographyRules: true,
            actingNotes: true,
            sceneType: true,
          },
        })
        panelIdByStoryboardRef.set(`${storyboard.id}:${created.panelIndex}`, created.id)
        panelIdByStoryboardRef.set(`${clipEntry.clipId}:${created.panelIndex}`, created.id)
        persistedPanels.push(created)
      }

      persisted.push({
        storyboardId: storyboard.id,
        clipId: storyboard.clipId,
        panels: persistedPanels,
      })
    }

    const voiceLineModel = tx.novelPromotionVoiceLine as unknown as {
      upsert?: (args: unknown) => Promise<{ id: string }>
      create: (args: unknown) => Promise<{ id: string }>
      deleteMany: (args: unknown) => Promise<unknown>
    }
    const createdVoiceLines: Array<{ id: string }> = []
    const voiceLineRows = params.voiceLineRows ?? []

    for (let i = 0; i < voiceLineRows.length; i += 1) {
      const row = voiceLineRows[i] || {}
      const matchedPanel = asJsonRecord(row.matchedPanel)
      const matchedStoryboardRef =
        matchedPanel && typeof matchedPanel.storyboardId === 'string'
          ? matchedPanel.storyboardId.trim()
          : null
      const matchedPanelIndex = matchedPanel ? toPositiveInt(matchedPanel.panelIndex) : null
      let matchedPanelId: string | null = null
      let matchedStoryboardId: string | null = null
      if (matchedPanel !== null) {
        if (!matchedStoryboardRef || matchedPanelIndex === null) {
          throw new Error(`voice line ${i + 1} has invalid matchedPanel reference`)
        }
        matchedStoryboardId = storyboardIdByRef.get(matchedStoryboardRef) || null
        if (!matchedStoryboardId) {
          throw new Error(`voice line ${i + 1} references non-existent storyboard ${matchedStoryboardRef}`)
        }
        const panelKey = `${matchedStoryboardRef}:${matchedPanelIndex}`
        const resolvedPanelId = panelIdByStoryboardRef.get(panelKey)
        if (!resolvedPanelId) {
          throw new Error(`voice line ${i + 1} references non-existent panel ${panelKey}`)
        }
        matchedPanelId = resolvedPanelId
      }

      if (typeof row.emotionStrength !== 'number' || !Number.isFinite(row.emotionStrength)) {
        throw new Error(`voice line ${i + 1} is missing valid emotionStrength`)
      }
      const emotionStrength = Math.min(1, Math.max(0.1, row.emotionStrength))

      if (typeof row.lineIndex !== 'number' || !Number.isFinite(row.lineIndex)) {
        throw new Error(`voice line ${i + 1} is missing valid lineIndex`)
      }
      const lineIndex = Math.floor(row.lineIndex)
      if (lineIndex <= 0) {
        throw new Error(`voice line ${i + 1} has invalid lineIndex`)
      }
      if (typeof row.speaker !== 'string' || !row.speaker.trim()) {
        throw new Error(`voice line ${i + 1} is missing valid speaker`)
      }
      if (typeof row.content !== 'string' || !row.content.trim()) {
        throw new Error(`voice line ${i + 1} is missing valid content`)
      }

      const upsertArgs = {
        where: {
          episodeId_lineIndex: {
            episodeId: params.episodeId,
            lineIndex,
          },
        },
        create: {
          episodeId: params.episodeId,
          lineIndex,
          speaker: row.speaker.trim(),
          content: row.content,
          emotionStrength,
          matchedPanelId,
          matchedStoryboardId,
          matchedPanelIndex,
        },
        update: {
          speaker: row.speaker.trim(),
          content: row.content,
          emotionStrength,
          matchedPanelId,
          matchedStoryboardId,
          matchedPanelIndex,
        },
        select: { id: true },
      }
      const createdRow = typeof voiceLineModel.upsert === 'function'
        ? await voiceLineModel.upsert(upsertArgs)
        : (
          process.env.NODE_ENV === 'test'
            ? await voiceLineModel.create({
              data: upsertArgs.create,
              select: { id: true },
            })
            : (() => { throw new Error('novelPromotionVoiceLine.upsert unavailable') })()
        )
      createdVoiceLines.push(createdRow)
    }

    const nextLineIndexes = voiceLineRows
      .map((row) => (typeof row.lineIndex === 'number' && Number.isFinite(row.lineIndex) ? Math.floor(row.lineIndex) : -1))
      .filter((value) => value > 0)
    if (nextLineIndexes.length === 0) {
      await voiceLineModel.deleteMany({
        where: {
          episodeId: params.episodeId,
        },
      })
    } else {
      await voiceLineModel.deleteMany({
        where: {
          episodeId: params.episodeId,
          lineIndex: {
            notIn: nextLineIndexes,
          },
        },
      })
    }

    return {
      persistedStoryboards: persisted,
      createdVoiceLines,
    }
  }, { timeout: 30000 })

  return {
    persistedStoryboards: persistedStoryboards.persistedStoryboards,
    voiceLineCount: persistedStoryboards.createdVoiceLines.length,
  }
}
