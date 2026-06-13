import { prisma } from '@/lib/prisma'
import {
  buildPanelSeedanceReferenceAssets,
  writePanelSeedanceReferenceAssetsToActingNotes,
} from './seedance-reference-assets'

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
  const panels = project.episodes.flatMap((episode) => (
    episode.storyboards.flatMap((storyboard) => storyboard.panels)
  ))

  for (const panel of panels) {
    const references = buildPanelSeedanceReferenceAssets({
      panel: {
        characters: panel.characters,
        location: panel.location,
        props: panel.props,
        videoPrompt: panel.videoPrompt,
      },
      characterAssets: project.characters,
      locationAssets: project.locations,
    })
    const actingNotes = writePanelSeedanceReferenceAssetsToActingNotes(panel.actingNotes, references)
    if ((actingNotes || null) === (panel.actingNotes || null)) continue
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: { actingNotes },
    })
    updatedPanelCount += 1
  }

  return { updatedPanelCount }
}
