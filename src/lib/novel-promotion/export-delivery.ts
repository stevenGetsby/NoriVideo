import { prisma } from '@/lib/prisma'
import archiver from 'archiver'
import {
  getObjectBuffer,
  getSignedUrl,
  toFetchableUrl,
  uploadObject,
} from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'

export type ExportDeliveryCardId = 'final-video' | 'asset-package' | 'voice-package' | 'jianying-draft'

export type ExportDeliveryStats = {
  clips: number
  panels: number
  images: number
  videos: number
  voices: number
}

export type ExportDeliveryOutput = {
  cardId: ExportDeliveryCardId
  title: string
  fileName: string
  stats: ExportDeliveryStats
  manifest: Record<string, unknown>
}

export type ExportDeliveryArtifact = ExportDeliveryOutput & {
  outputStorageKey: string
  outputUrl: string
  contentType: string
  sizeBytes: number
}

const CARD_TITLES: Record<ExportDeliveryCardId, string> = {
  'final-video': 'Final Video',
  'asset-package': 'Asset Package',
  'voice-package': 'Voice Package',
  'jianying-draft': 'Editing Draft',
}

export function normalizeExportDeliveryCardId(value: unknown): ExportDeliveryCardId | null {
  if (value === 'final-video' || value === 'asset-package' || value === 'voice-package' || value === 'jianying-draft') return value
  return null
}

export function safeExportFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'export'
}

function toDurationMs(duration: number | null | undefined) {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return 3000
  return Math.max(500, Math.round(duration * 1000))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getArrayField(value: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const field = value[key]
  return Array.isArray(field) ? field.filter(isRecord) : []
}

function readString(value: Record<string, unknown>, key: string) {
  const field = value[key]
  return typeof field === 'string' ? field : null
}

function safeZipEntrySegment(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 50) || 'asset'
}

function safeArtifactKeySegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'artifact'
}

function extensionFromSource(source: string | null, fallback: string, allowed: readonly string[]) {
  if (!source) return fallback
  const clean = source.split('?')[0]?.split('#')[0] || source
  const ext = clean.split('.').pop()?.toLowerCase() || ''
  if (allowed.includes(ext)) return ext === 'jpeg' ? 'jpg' : ext
  return fallback
}

async function readMediaBuffer(source: string) {
  const storageKey = await resolveStorageKeyFromMediaValue(source)
  if (storageKey) {
    return {
      buffer: await getObjectBuffer(storageKey),
      storageKey,
    }
  }

  const response = await fetch(toFetchableUrl(source))
  if (!response.ok) {
    throw new Error(`failed to fetch export media: ${response.status} ${response.statusText}`)
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    storageKey: null,
    contentType: response.headers.get('content-type') || null,
  }
}

async function zipEntries(entries: Array<{ name: string; buffer: Buffer }>) {
  const archive = archiver('zip', { zlib: { level: 9 } })
  const chunks: Buffer[] = []
  const finished = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    archive.on('end', resolve)
    archive.on('error', reject)
  })

  for (const entry of entries) {
    archive.append(entry.buffer, { name: entry.name })
  }

  await archive.finalize()
  await finished
  return Buffer.concat(chunks)
}

async function buildFinalVideoZip(output: ExportDeliveryOutput) {
  const panels = getArrayField(output.manifest, 'panels')
  const entries: Array<{ name: string; buffer: Buffer }> = []

  for (const [index, panel] of panels.entries()) {
    const videoUrl = readString(panel, 'lipSyncVideoUrl') || readString(panel, 'videoUrl')
    if (!videoUrl) continue
    const media = await readMediaBuffer(videoUrl)
    const description = readString(panel, 'description') || `shot_${index + 1}`
    const ext = extensionFromSource(media.storageKey || videoUrl, 'mp4', ['mp4', 'mov', 'webm'])
    entries.push({
      name: `videos/${String(entries.length + 1).padStart(3, '0')}_${safeZipEntrySegment(description)}.${ext}`,
      buffer: media.buffer,
    })
  }

  if (entries.length === 0) {
    throw new Error('no generated videos available for export')
  }

  entries.push({
    name: 'manifest.json',
    buffer: Buffer.from(JSON.stringify(output.manifest, null, 2)),
  })
  return zipEntries(entries)
}

async function buildAssetPackageZip(output: ExportDeliveryOutput) {
  const panels = getArrayField(output.manifest, 'panels')
  const entries: Array<{ name: string; buffer: Buffer }> = []

  for (const [index, panel] of panels.entries()) {
    const imageUrl = readString(panel, 'imageUrl')
    if (!imageUrl) continue
    const media = await readMediaBuffer(imageUrl)
    const description = readString(panel, 'description') || `shot_${index + 1}`
    const contentType = media.contentType || ''
    const fallback = contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') ? 'jpg' : 'png'
    const ext = extensionFromSource(media.storageKey || imageUrl, fallback, ['png', 'jpg', 'jpeg', 'webp', 'gif'])
    entries.push({
      name: `images/${String(entries.length + 1).padStart(3, '0')}_${safeZipEntrySegment(description)}.${ext}`,
      buffer: media.buffer,
    })
  }

  if (entries.length === 0) {
    throw new Error('no storyboard images available for export')
  }

  entries.push({
    name: 'manifest.json',
    buffer: Buffer.from(JSON.stringify(output.manifest, null, 2)),
  })
  return zipEntries(entries)
}

async function buildVoicePackageZip(output: ExportDeliveryOutput) {
  const voiceLines = getArrayField(output.manifest, 'voiceLines')
  const entries: Array<{ name: string; buffer: Buffer }> = []

  for (const [index, line] of voiceLines.entries()) {
    const audioUrl = readString(line, 'audioUrl')
    if (!audioUrl) continue
    const media = await readMediaBuffer(audioUrl)
    const speaker = readString(line, 'speaker') || `speaker_${index + 1}`
    const content = readString(line, 'content') || `line_${index + 1}`
    const ext = extensionFromSource(media.storageKey || audioUrl, 'mp3', ['mp3', 'wav', 'm4a', 'aac', 'ogg'])
    entries.push({
      name: `voices/${String(entries.length + 1).padStart(3, '0')}_${safeZipEntrySegment(speaker)}_${safeZipEntrySegment(content)}.${ext}`,
      buffer: media.buffer,
    })
  }

  if (entries.length === 0) {
    throw new Error('no generated voice lines available for export')
  }

  entries.push({
    name: 'manifest.json',
    buffer: Buffer.from(JSON.stringify(output.manifest, null, 2)),
  })
  return zipEntries(entries)
}

function buildDraftMediaReferences(output: ExportDeliveryOutput) {
  const panels = getArrayField(output.manifest, 'panels')
  const voiceLines = getArrayField(output.manifest, 'voiceLines')

  return {
    videos: panels
      .map((panel, index) => ({
        id: readString(panel, 'id') || `panel-${index + 1}`,
        panelIndex: panel.panelIndex,
        sourceUrl: readString(panel, 'lipSyncVideoUrl') || readString(panel, 'videoUrl'),
      }))
      .filter((item) => item.sourceUrl),
    images: panels
      .map((panel, index) => ({
        id: readString(panel, 'id') || `panel-${index + 1}`,
        panelIndex: panel.panelIndex,
        sourceUrl: readString(panel, 'imageUrl'),
      }))
      .filter((item) => item.sourceUrl),
    audios: voiceLines
      .map((line, index) => ({
        id: readString(line, 'id') || `voice-${index + 1}`,
        lineIndex: line.lineIndex,
        speaker: readString(line, 'speaker'),
        sourceUrl: readString(line, 'audioUrl'),
      }))
      .filter((item) => item.sourceUrl),
  }
}

function buildJianyingDraftContent(output: ExportDeliveryOutput) {
  const draft = isRecord(output.manifest.jianyingDraft)
    ? output.manifest.jianyingDraft
    : {
        schema: 'nori-video.jianying-draft.v1',
        generatedAt: new Date().toISOString(),
        timeline: [],
      }
  const timeline = Array.isArray(draft.timeline) ? draft.timeline.filter(isRecord) : []
  const durationMs = timeline.reduce((max, item) => {
    const startMs = typeof item.startMs === 'number' ? item.startMs : 0
    const itemDurationMs = typeof item.durationMs === 'number' ? item.durationMs : 0
    return Math.max(max, startMs + itemDurationMs)
  }, 0)

  return {
    schema: 'nori-video.jianying-draft-package.v1',
    sourceSchema: draft.schema || 'nori-video.jianying-draft.v1',
    generatedAt: draft.generatedAt || output.manifest.generatedAt,
    project: output.manifest.project || null,
    episode: output.manifest.episode || null,
    canvasConfig: {
      ratio: '9:16',
      fps: 30,
      resolution: {
        width: 1080,
        height: 1920,
      },
    },
    durationMs,
    tracks: {
      mainVideo: timeline.map((item, index) => ({
        id: item.id || `clip-${index + 1}`,
        order: item.order || index + 1,
        startMs: item.startMs || 0,
        durationMs: item.durationMs || 3000,
        sourceVideoUrl: item.sourceVideoUrl || null,
        sourceImageUrl: item.sourceImageUrl || null,
        panelIndex: item.panelIndex ?? null,
        panelNumber: item.panelNumber ?? null,
      })),
      subtitles: timeline
        .filter((item) => typeof item.subtitle === 'string' && item.subtitle.trim())
        .map((item, index) => ({
          id: `${item.id || `clip-${index + 1}`}-subtitle`,
          startMs: item.startMs || 0,
          durationMs: item.durationMs || 3000,
          text: item.subtitle,
        })),
    },
  }
}

function buildJianyingDraftMeta(output: ExportDeliveryOutput) {
  const content = buildJianyingDraftContent(output)
  return {
    schema: 'nori-video.jianying-draft-meta.v1',
    generatedAt: output.manifest.generatedAt || new Date().toISOString(),
    title: output.title,
    fileName: output.fileName,
    packageType: 'jianying-draft',
    compatibility: {
      officialJianyingImport: false,
      note: 'NoriVideo draft package with Jianying-oriented structure; official import mapping still requires a future adapter.',
    },
    stats: output.stats,
    durationMs: content.durationMs,
  }
}

export function buildJianyingDraftPackageEntries(output: ExportDeliveryOutput) {
  const mediaReferences = buildDraftMediaReferences(output)
  return [
    {
      name: 'draft_content.json',
      buffer: Buffer.from(JSON.stringify(buildJianyingDraftContent(output), null, 2)),
    },
    {
      name: 'draft_meta_info.json',
      buffer: Buffer.from(JSON.stringify(buildJianyingDraftMeta(output), null, 2)),
    },
    {
      name: 'manifest.json',
      buffer: Buffer.from(JSON.stringify(output.manifest, null, 2)),
    },
    {
      name: 'materials/video.json',
      buffer: Buffer.from(JSON.stringify(mediaReferences.videos, null, 2)),
    },
    {
      name: 'materials/image.json',
      buffer: Buffer.from(JSON.stringify(mediaReferences.images, null, 2)),
    },
    {
      name: 'materials/audio.json',
      buffer: Buffer.from(JSON.stringify(mediaReferences.audios, null, 2)),
    },
    {
      name: 'README.md',
      buffer: Buffer.from([
        '# NoriVideo editing draft package',
        '',
        'This package preserves a Jianying-oriented draft structure for downstream adapter work.',
        'It is not yet guaranteed to be directly importable by official Jianying clients.',
        '',
      ].join('\n')),
    },
  ]
}

async function buildJianyingDraftPackageZip(output: ExportDeliveryOutput) {
  return zipEntries(buildJianyingDraftPackageEntries(output))
}

async function buildArtifactBuffer(output: ExportDeliveryOutput) {
  if (output.cardId === 'final-video') {
    return {
      buffer: await buildFinalVideoZip(output),
      ext: 'zip',
      contentType: 'application/zip',
    }
  }
  if (output.cardId === 'asset-package') {
    return {
      buffer: await buildAssetPackageZip(output),
      ext: 'zip',
      contentType: 'application/zip',
    }
  }
  if (output.cardId === 'voice-package') {
    return {
      buffer: await buildVoicePackageZip(output),
      ext: 'zip',
      contentType: 'application/zip',
    }
  }
  return {
    buffer: await buildJianyingDraftPackageZip(output),
    ext: 'zip',
    contentType: 'application/zip',
  }
}

function buildDraftTimeline(panels: Array<{
  id: string
  panelIndex: number
  panelNumber: number | null
  duration: number | null
  videoUrl: string | null
  lipSyncVideoUrl: string | null
  imageUrl: string | null
  srtSegment: string | null
  srtStart: number | null
  srtEnd: number | null
}>) {
  let cursorMs = 0
  return panels.map((panel, index) => {
    const durationMs = toDurationMs(panel.duration)
    const item = {
      id: panel.id,
      track: 'main',
      order: index + 1,
      panelIndex: panel.panelIndex,
      panelNumber: panel.panelNumber,
      startMs: cursorMs,
      durationMs,
      sourceVideoUrl: panel.lipSyncVideoUrl || panel.videoUrl || null,
      sourceImageUrl: panel.imageUrl || null,
      subtitle: panel.srtSegment || null,
      srtStart: panel.srtStart,
      srtEnd: panel.srtEnd,
    }
    cursorMs += durationMs
    return item
  })
}

export async function buildExportDeliveryOutput(params: {
  userId: string
  projectId: string
  episodeId: string
  cardId: ExportDeliveryCardId
  title?: string | null
}): Promise<ExportDeliveryOutput> {
  const project = await prisma.project.findFirst({
    where: {
      id: params.projectId,
      userId: params.userId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      novelPromotionData: {
        select: {
          episodes: {
            where: { id: params.episodeId },
            include: {
              editorProject: true,
              clips: { orderBy: { createdAt: 'asc' } },
              voiceLines: { orderBy: { lineIndex: 'asc' } },
              storyboards: {
                orderBy: { createdAt: 'asc' },
                include: {
                  clip: true,
                  panels: { orderBy: { panelIndex: 'asc' } },
                },
              },
            },
          },
        },
      },
    },
  })

  const episode = project?.novelPromotionData?.episodes[0]
  if (!project || !episode) {
    throw new Error('export episode not found')
  }

  const panels = episode.storyboards.flatMap((storyboard) =>
    storyboard.panels.map((panel) => ({
      id: panel.id,
      storyboardId: storyboard.id,
      clipId: storyboard.clipId,
      clipSummary: storyboard.clip.summary,
      panelIndex: panel.panelIndex,
      panelNumber: panel.panelNumber,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      location: panel.location,
      characters: panel.characters,
      props: panel.props,
      duration: panel.duration,
      imagePrompt: panel.imagePrompt,
      imageUrl: panel.imageUrl,
      videoPrompt: panel.videoPrompt,
      videoUrl: panel.videoUrl,
      lipSyncVideoUrl: panel.lipSyncVideoUrl,
      srtSegment: panel.srtSegment,
      srtStart: panel.srtStart,
      srtEnd: panel.srtEnd,
    })),
  )
  const imagePanels = panels.filter((panel) => panel.imageUrl)
  const videoPanels = panels.filter((panel) => panel.videoUrl || panel.lipSyncVideoUrl)
  const voiceLines = episode.voiceLines.filter((line) => line.audioUrl)
  const stats: ExportDeliveryStats = {
    clips: episode.clips.length,
    panels: panels.length,
    images: imagePanels.length,
    videos: videoPanels.length,
    voices: voiceLines.length,
  }

  if (params.cardId === 'final-video' && videoPanels.length === 0) {
    throw new Error('no generated videos available for export')
  }
  if (params.cardId === 'asset-package' && imagePanels.length === 0) {
    throw new Error('no storyboard images available for export')
  }
  if (params.cardId === 'voice-package' && voiceLines.length === 0) {
    throw new Error('no generated voice lines available for export')
  }
  if (params.cardId === 'jianying-draft' && panels.length === 0) {
    throw new Error('no storyboard panels available for editing draft')
  }

  const baseName = safeExportFileName(`${project.name}_${episode.name}`)
  const fileName = params.cardId === 'final-video'
    ? `${baseName}_videos.zip`
    : params.cardId === 'asset-package'
      ? `${baseName}_images.zip`
      : params.cardId === 'voice-package'
        ? `${baseName}_voices.zip`
        : `${baseName}_jianying_draft.zip`
  const title = params.title || CARD_TITLES[params.cardId]
  const generatedAt = new Date().toISOString()

  return {
    cardId: params.cardId,
    title,
    fileName,
    stats,
    manifest: {
      schema: 'nori-video.export-delivery.v1',
      generatedAt,
      deliveryType: params.cardId,
      fileName,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
      },
      episode: {
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        description: episode.description,
      },
      stats: {
        ...stats,
        missingVideos: Math.max(panels.length - videoPanels.length, 0),
      },
      clips: episode.clips.map((clip, index) => ({
        id: clip.id,
        index: index + 1,
        summary: clip.summary,
        content: clip.content,
        screenplay: clip.screenplay,
        location: clip.location,
        characters: clip.characters,
        props: clip.props,
        duration: clip.duration,
        shotCount: clip.shotCount,
      })),
      panels,
      voiceLines: episode.voiceLines.map((line) => ({
        id: line.id,
        lineIndex: line.lineIndex,
        speaker: line.speaker,
        content: line.content,
        audioUrl: line.audioUrl,
        audioDuration: line.audioDuration,
        matchedPanelId: line.matchedPanelId,
      })),
      editorProject: episode.editorProject
        ? {
            id: episode.editorProject.id,
            renderStatus: episode.editorProject.renderStatus,
            outputUrl: episode.editorProject.outputUrl,
            updatedAt: episode.editorProject.updatedAt.toISOString(),
          }
        : null,
      jianyingDraft: params.cardId === 'jianying-draft'
        ? {
            schema: 'nori-video.jianying-draft.v1',
            generatedAt,
            timeline: buildDraftTimeline(panels),
          }
        : null,
    },
  }
}

export async function buildAndUploadExportDeliveryArtifact(params: {
  userId: string
  projectId: string
  episodeId: string
  cardId: ExportDeliveryCardId
  title?: string | null
  taskId?: string | null
}): Promise<ExportDeliveryArtifact> {
  const output = await buildExportDeliveryOutput(params)
  const artifact = await buildArtifactBuffer(output)
  const fallbackId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const outputStorageKey = await uploadObject(
    artifact.buffer,
    [
      'artifacts',
      'novel-promotion',
      safeArtifactKeySegment(params.userId),
      safeArtifactKeySegment(params.projectId),
      safeArtifactKeySegment(params.episodeId),
      safeArtifactKeySegment(params.taskId || fallbackId),
      `${safeArtifactKeySegment(output.cardId)}.${artifact.ext}`,
    ].join('/'),
    1,
    artifact.contentType,
  )

  return {
    ...output,
    outputStorageKey,
    outputUrl: getSignedUrl(outputStorageKey, 7 * 24 * 60 * 60),
    contentType: artifact.contentType,
    sizeBytes: artifact.buffer.length,
  }
}
