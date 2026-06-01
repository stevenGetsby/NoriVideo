import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: 'desc' } })
  if (!project) { console.log('NO PROJECT'); return }

  const npProject = await prisma.novelPromotionProject.findFirst({ where: { projectId: project.id } })
  if (!npProject) { console.log('NO NP PROJECT'); return }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { novelPromotionProjectId: npProject.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!episode) { console.log('NO EPISODE'); return }

  console.log('Project:', project.id, '-', project.name)
  console.log('Episode:', episode.id, '-', episode.name)

  // Check existing storyboards
  const existingSBs = await prisma.novelPromotionStoryboard.count({ where: { episodeId: episode.id } })
  console.log('Existing storyboards:', existingSBs)

  if (existingSBs > 0) {
    // Check if panels already have candidates
    const sb = await prisma.novelPromotionStoryboard.findFirst({
      where: { episodeId: episode.id },
    })
    const panels = await prisma.novelPromotionPanel.findMany({
      where: { storyboardId: sb.id },
    })
    console.log('Existing panels:', panels.length)

    if (panels.length === 0) {
      // Create panels for existing empty storyboard
      const descriptions = [
        '清晨的阳光透过窗帘照进房间，小明揉着眼睛从床上坐起来。',
        '小明看了一眼床头的闹钟，猛地跳了起来，手忙脚乱地穿衣服。',
        '小明冲出家门，一路狂奔向学校，背后书包随着步伐上下跳动。',
      ]
      for (let i = 0; i < descriptions.length; i++) {
        const mockCandidates = [
          `https://placehold.co/512x768/1a1a2e/e0e0e0?text=P${i + 1}-A`,
          `https://placehold.co/512x768/2a2a3e/e0e0e0?text=P${i + 1}-B`,
          `https://placehold.co/512x768/3a3a4e/e0e0e0?text=P${i + 1}-C`,
        ]
        await prisma.novelPromotionPanel.create({
          data: {
            storyboardId: sb.id,
            panelIndex: i,
            shotType: ['medium', 'close-up', 'wide'][i],
            cameraMove: 'static',
            description: descriptions[i],
            imagePrompt: descriptions[i],
            videoPrompt: descriptions[i],
            imageUrl: mockCandidates[0],
            candidateImages: JSON.stringify(mockCandidates),
          },
        })
      }
      console.log('Created 3 panels with 3 candidates each for existing storyboard')
    } else {
      // Add mock candidates to existing panels
      let updated = 0
      for (const panel of panels) {
        const currentCandidates = panel.candidateImageUrls ? JSON.parse(panel.candidateImageUrls) : []
        if (currentCandidates.length < 2) {
          const mockCandidates = [
            panel.imageUrl || 'https://placehold.co/512x768/1a1a2e/e0e0e0?text=A',
            'https://placehold.co/512x768/2a2a3e/e0e0e0?text=B',
            'https://placehold.co/512x768/3a3a4e/e0e0e0?text=C',
          ]
          await prisma.novelPromotionPanel.update({
            where: { id: panel.id },
            data: {
              candidateImages: JSON.stringify(mockCandidates),
              imageUrl: mockCandidates[0],
            },
          })
          updated++
        }
      }
      console.log('Updated', updated, 'panels with mock candidates')
    }
  } else {
    // Create a storyboard with panels
    let clipId
    const clip = await prisma.novelPromotionClip.findFirst({
      where: { episodeId: episode.id },
      orderBy: { createdAt: 'desc' },
    })

    if (clip) {
      clipId = clip.id
      console.log('Using existing clip:', clipId)
    } else {
      console.log('No clip found, creating one...')
      const newClip = await prisma.novelPromotionClip.create({
        data: {
          episodeId: episode.id,
          summary: '清晨小明起床上学',
          content: '清晨小明上学的故事。阳光洒进房间，小明急忙起床冲向学校。',
        },
      })
      clipId = newClip.id
      console.log('Created clip:', clipId)
    }

    const sb = await prisma.novelPromotionStoryboard.create({
      data: {
        episodeId: episode.id,
        clipId: clipId,
      },
    })

    const descriptions = [
      '清晨的阳光透过窗帘照进房间，小明揉着眼睛从床上坐起来。',
      '小明看了一眼床头的闹钟，猛地跳了起来，手忙脚乱地穿衣服。',
      '小明冲出家门，一路狂奔向学校，背后书包随着步伐上下跳动。',
    ]

    for (let i = 0; i < descriptions.length; i++) {
      const mockCandidates = [
        `https://placehold.co/512x768/1a1a2e/e0e0e0?text=P${i + 1}-A`,
        `https://placehold.co/512x768/2a2a3e/e0e0e0?text=P${i + 1}-B`,
        `https://placehold.co/512x768/3a3a4e/e0e0e0?text=P${i + 1}-C`,
      ]

      await prisma.novelPromotionPanel.create({
        data: {
          storyboardId: sb.id,
          panelIndex: i,
          shotType: ['medium', 'close-up', 'wide'][i],
          cameraMove: 'static',
          description: descriptions[i],
          imagePrompt: descriptions[i],
          videoPrompt: descriptions[i],
          imageUrl: mockCandidates[0],
          candidateImages: JSON.stringify(mockCandidates),
        },
      })
    }

    console.log('Created storyboard with 3 panels, each with 3 candidates')
  }

  await prisma.$disconnect()
  console.log('Done!')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
