import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer, toFetchableUrl } from '@/lib/storage'

export const runtime = 'nodejs'

type SaveRequestBody = {
  taskIds?: unknown
  directoryPath?: unknown
}

const MAX_BATCH_SAVE_COUNT = 100

function sanitizeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'enhanced-video.mp4'
}

function resultFileName(name: string): string {
  const rawName = name.split('?')[0] || 'enhanced-video'
  const withoutExt = rawName.replace(/\.[a-z0-9]{2,5}$/i, '')
  return `${sanitizeFileName(withoutExt)}-enhanced.mp4`
}

function makeUniqueFileName(fileName: string, usedNames: Set<string>): string {
  const normalized = sanitizeFileName(fileName)
  const extensionIndex = normalized.lastIndexOf('.')
  const baseName = extensionIndex > 0 ? normalized.slice(0, extensionIndex) : normalized
  const extension = extensionIndex > 0 ? normalized.slice(extensionIndex) : ''
  let candidate = normalized
  let index = 2
  while (usedNames.has(candidate)) {
    candidate = `${baseName}-${index}${extension}`
    index += 1
  }
  usedNames.add(candidate)
  return candidate
}

function readResultVideoUrl(result: unknown): string | null {
  if (!result || Array.isArray(result) || typeof result !== 'object') return null
  const value = (result as { videoUrl?: unknown }).videoUrl
  return typeof value === 'string' && value ? value : null
}

function normalizeDirectoryPath(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: '请填写下载目录路径' })
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new ApiError('INVALID_PARAMS', { message: '请填写下载目录路径' })
  }
  if (trimmed.includes('\0')) {
    throw new ApiError('INVALID_PARAMS', { message: '下载目录路径无效' })
  }

  const expanded = trimmed === '~' || trimmed.startsWith('~/')
    ? path.join(os.homedir(), trimmed.slice(2))
    : trimmed
  const resolved = path.resolve(expanded)

  if (!path.isAbsolute(resolved)) {
    throw new ApiError('INVALID_PARAMS', { message: '下载目录路径必须是绝对路径' })
  }

  return resolved
}

function normalizeTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择要下载的任务' })
  }

  const taskIds = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  const uniqueTaskIds = Array.from(new Set(taskIds))

  if (uniqueTaskIds.length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择要下载的任务' })
  }
  if (uniqueTaskIds.length > MAX_BATCH_SAVE_COUNT) {
    throw new ApiError('INVALID_PARAMS', { message: `单次最多保存 ${MAX_BATCH_SAVE_COUNT} 个结果` })
  }
  if (uniqueTaskIds.some((taskId) => !/^[A-Za-z0-9._:-]+$/.test(taskId))) {
    throw new ApiError('INVALID_PARAMS', { message: '任务 ID 无效' })
  }

  return uniqueTaskIds
}

async function readResultBuffer(record: {
  resultStorageKey: string | null
  resultVideoUrl: string | null
  result: unknown
}): Promise<Buffer> {
  if (record.resultStorageKey) return await getObjectBuffer(record.resultStorageKey)

  const resultVideoUrl = record.resultVideoUrl || readResultVideoUrl(record.result)
  if (!resultVideoUrl) {
    throw new Error('增强结果文件不存在或尚未完成归档')
  }

  const response = await fetch(toFetchableUrl(resultVideoUrl))
  if (!response.ok) {
    throw new Error(`读取增强结果失败：HTTP ${response.status}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const body = await request.json().catch(() => ({})) as SaveRequestBody
  const taskIds = normalizeTaskIds(body.taskIds)
  const directoryPath = normalizeDirectoryPath(body.directoryPath)

  await mkdir(directoryPath, { recursive: true })

  const records = await prisma.videoEnhanceTask.findMany({
    where: {
      userId: session.user.id,
      mediaKitTaskId: { in: taskIds },
      status: 'completed',
    },
    select: {
      mediaKitTaskId: true,
      name: true,
      result: true,
      resultStorageKey: true,
      resultVideoUrl: true,
    },
  })
  const recordByTaskId = new Map(records.map((record) => [record.mediaKitTaskId, record]))
  const usedNames = new Set<string>()
  const saved: Array<{ taskId: string; fileName: string; filePath: string; bytes: number }> = []
  const failed: Array<{ taskId: string; name?: string; error: string }> = []

  for (const taskId of taskIds) {
    const record = recordByTaskId.get(taskId)
    if (!record) {
      failed.push({ taskId, error: '未找到已完成的增强任务' })
      continue
    }

    try {
      const buffer = await readResultBuffer(record)
      const fileName = makeUniqueFileName(resultFileName(record.name), usedNames)
      const filePath = path.join(directoryPath, fileName)
      await writeFile(filePath, buffer)
      saved.push({ taskId, fileName, filePath, bytes: buffer.length })
    } catch (error) {
      failed.push({
        taskId,
        name: record.name,
        error: error instanceof Error ? error.message : '保存失败',
      })
    }
  }

  return NextResponse.json({
    success: saved.length > 0,
    directoryPath,
    savedCount: saved.length,
    failedCount: failed.length,
    saved,
    failed,
  })
})
