import { prisma } from '@/lib/prisma'
import { buildNovelVideoExportFileName } from '@/lib/novel-promotion/video-export-name'

export async function materialDownloadFileName(material: {
  id: string; projectId: string; title: string | null; ownerName: string | null; type: string; createdAt: Date; metadata: unknown
}) {
  const project = material.projectId === 'global' || material.projectId === 'global-asset-hub' ? null
    : await prisma.project.findUnique({ where: { id: material.projectId }, select: { name: true, work: { select: { name: true } } } })
  const settings = project ? await prisma.novelPromotionProject.findUnique({ where: { projectId: material.projectId }, select: { exportNamingTemplate: true } }) : null
  const sequence = await prisma.frameosMaterial.count({
    where: { projectId: material.projectId, type: material.type, OR: [{ createdAt: { lt: material.createdAt } }, { createdAt: material.createdAt, id: { lte: material.id } }] },
  })
  const metadata = material.metadata && typeof material.metadata === 'object' && !Array.isArray(material.metadata) ? material.metadata as Record<string, unknown> : {}
  let generationIndex = typeof metadata.generationIndex === 'number' ? metadata.generationIndex : null
  const asset = material.type === 'video' ? await prisma.frameosToolboxAsset.findFirst({ where: { materialId: material.id }, select: { id: true, createdAt: true, params: true } }) : null
  if (asset && generationIndex === null) {
    const params = asset.params && typeof asset.params === 'object' && !Array.isArray(asset.params) ? asset.params as Record<string, unknown> : {}
    const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
    const title = typeof params.title === 'string' ? params.title : ''
    if (nodeId || title) generationIndex = await prisma.frameosToolboxAsset.count({
      where: { projectId: material.projectId, type: 'video',
        params: { path: nodeId ? '$.nodeId' : '$.title', equals: nodeId || title },
        OR: [{ createdAt: { lt: asset.createdAt } }, { createdAt: asset.createdAt, id: { lte: asset.id } }] },
    })
  }
  return buildNovelVideoExportFileName({
    projectName: project?.work.name || project?.name || '账号素材', sequence: Math.max(1, sequence),
    generationName: material.title, creatorName: material.ownerName || '未记录创建者',
    template: material.type === 'video' ? settings?.exportNamingTemplate : `{project}_{generation}_${material.type === 'image' ? '图片' : material.type === 'audio' ? '音频' : '模型'}{sequence}_{creator}`,
    generationIndex,
  })
}
