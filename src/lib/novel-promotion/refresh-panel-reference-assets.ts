import { prisma } from '@/lib/prisma'
import {
  buildPanelSeedanceReferenceAssets,
  mergePanelSeedanceReferenceAssets,
  readPanelSeedanceReferenceAssetsFromActingNotes,
  writePanelSeedanceReferenceAssetsToActingNotes,
} from './seedance-reference-assets'
import { readPanelFrameOSMetadataFromActingNotes } from './panel-frameos-metadata'

function readPanelSceneId(actingNotes: unknown): string | null {
  const panelId = readPanelFrameOSMetadataFromActingNotes(actingNotes)?.panel_id
  return typeof panelId === 'string' ? panelId.match(/^S\d+/i)?.[0] || null : null
}

export async function refreshProjectPanelReferenceAssets(params: {
  projectId: string
  episodeId?: string | null
}): Promise<{ updatedPanelCount: number }> {
  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
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
      episodes: {
        where: params.episodeId ? { id: params.episodeId } : undefined,
        include: {
          storyboards: {
            include: {
              panels: true,
            },
          },
        },
      },
    },
  })

  if (!project) return { updatedPanelCount: 0 }

  let updatedPanelCount = 0
  for (const episode of project.episodes) {
    const panels = episode.storyboards.flatMap((storyboard) => storyboard.panels)
    for (const panel of panels) {
      const generated = buildPanelSeedanceReferenceAssets({
        panel: {
          characters: panel.characters,
          location: panel.location,
          props: panel.props,
          videoPrompt: panel.videoPrompt,
        },
        characterAssets: project.characters,
        locationAssets: project.locations,
        episodeNumber: episode.episodeNumber,
        sceneId: readPanelSceneId(panel.actingNotes),
      })
      const references = mergePanelSeedanceReferenceAssets(
        generated,
        readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes),
      )
      const actingNotes = writePanelSeedanceReferenceAssetsToActingNotes(panel.actingNotes, references)
      if ((actingNotes || null) === (panel.actingNotes || null)) continue
      await prisma.novelPromotionPanel.update({
        where: { id: panel.id },
        data: { actingNotes },
      })
      updatedPanelCount += 1
    }
  }

  return { updatedPanelCount }
}
