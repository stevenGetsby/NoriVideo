import { NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { projectReadWhere, workspaceUserWhere, getWorkspaceActor } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer, extractStorageKey } from '@/lib/storage'
import { materialDownloadFileName } from '@/lib/frameos/material-download'

export const GET = apiHandler(async (_request, context: { params: Promise<{ materialId: string }> }) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const { materialId } = await context.params
  const actor = getWorkspaceActor(auth.session)
  const users = await prisma.user.findMany({ where: workspaceUserWhere(actor.workspaceOwnerId), select: { id: true } })
  const material = await prisma.frameosMaterial.findFirst({ where: { id: materialId, userId: { in: users.map((user) => user.id) }, status: 'ready', deletedAt: null } })
  if (!material) throw new ApiError('NOT_FOUND')
  if (!['global', 'global-asset-hub'].includes(material.projectId)) {
    const project = await prisma.project.findFirst({ where: projectReadWhere(auth.session, material.projectId), select: { id: true } })
    if (!project) throw new ApiError('NOT_FOUND')
  }
  const key = material.storageKey || extractStorageKey(material.resultUrl)
  if (!key) throw new ApiError('INVALID_PARAMS', { message: '该旧素材没有可下载的存储对象，请重新保存素材。' })
  const buffer = await getObjectBuffer(key)
  const ext = key.split('.').at(-1)?.toLowerCase()
  const extensions: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', glb: 'model/gltf-binary' }
  if (!ext || !extensions[ext]) throw new ApiError('INVALID_PARAMS', { message: '该文件格式暂不支持下载。' })
  const name = (await materialDownloadFileName(material)).replace(/\.mp4$/, `.${ext}`)
  return new NextResponse(new Uint8Array(buffer), { headers: {
    'Content-Type': extensions[ext], 'Content-Length': String(buffer.length),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Nori-Filename': encodeURIComponent(name), 'Cache-Control': 'private, no-store',
  } })
})
