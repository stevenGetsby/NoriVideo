import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { projectReadWhere, workspaceUserWhere, getWorkspaceActor } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { getSignedObjectUrl, toFetchableUrl, extractStorageKey } from '@/lib/storage'
import { materialDownloadFileName } from '@/lib/frameos/material-download'

export const GET = apiHandler(async (request: NextRequest, context: { params: Promise<{ materialId: string }> }) => {
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
  const ext = key.split('.').at(-1)?.toLowerCase()
  const extensions: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', glb: 'model/gltf-binary' }
  if (!ext || !extensions[ext]) throw new ApiError('INVALID_PARAMS', { message: '该文件格式暂不支持下载。' })
  const name = (await materialDownloadFileName(material)).replace(/\.mp4$/, `.${ext}`)
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`

  // Direct-connect mode: hand the client a signed object-storage URL so the
  // bytes skip the web process. Falls back to the streaming proxy below until
  // the bucket has CORS configured.
  if (request.nextUrl.searchParams.get('mode') === 'url') {
    const url = await getSignedObjectUrl(key, 600, { responseContentDisposition: disposition })
    return NextResponse.json({ url, filename: name })
  }

  const upstream = await fetch(toFetchableUrl(await getSignedObjectUrl(key, 600)))
  if (!upstream.ok || !upstream.body) {
    throw new ApiError('EXTERNAL_ERROR', { message: `读取素材文件失败：HTTP ${upstream.status}` })
  }
  const headers = new Headers({
    'Content-Type': extensions[ext],
    'Content-Disposition': disposition,
    'X-Nori-Filename': encodeURIComponent(name),
    'Cache-Control': 'private, no-store',
  })
  const length = upstream.headers.get('content-length')
  if (length) headers.set('Content-Length', length)
  return new NextResponse(upstream.body, { status: 200, headers })
})
