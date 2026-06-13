import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encryptApiKey, decryptApiKey } from '@/lib/crypto-utils'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const pref = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: {
      arkAssetsAccessKeyId: true,
      arkAssetsSecretAccessKey: true,
      arkAssetsProjectName: true,
    },
  })

  const accessKeyId = pref?.arkAssetsAccessKeyId ? decryptApiKey(pref.arkAssetsAccessKeyId) : ''
  const secretAccessKey = pref?.arkAssetsSecretAccessKey ? decryptApiKey(pref.arkAssetsSecretAccessKey) : ''

  return NextResponse.json({
    accessKeyId,
    secretAccessKey,
    projectName: pref?.arkAssetsProjectName || 'default',
    configured: !!accessKeyId && !!secretAccessKey,
  })
})

export const PUT = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'BODY_PARSE_FAILED', field: 'body' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS', { code: 'BODY_INVALID', field: 'body' })
  }

  const record = body as Record<string, unknown>
  const accessKeyId = readTrimmedString(record.accessKeyId)
  const secretAccessKey = readTrimmedString(record.secretAccessKey)
  const projectName = readTrimmedString(record.projectName) || 'default'

  if (!accessKeyId || !secretAccessKey) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SEEDANCE_ASSETS_CONFIG_REQUIRED',
      field: 'accessKeyId',
    })
  }

  await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: {
      arkAssetsAccessKeyId: encryptApiKey(accessKeyId),
      arkAssetsSecretAccessKey: encryptApiKey(secretAccessKey),
      arkAssetsProjectName: projectName,
    },
    create: {
      userId: session.user.id,
      arkAssetsAccessKeyId: encryptApiKey(accessKeyId),
      arkAssetsSecretAccessKey: encryptApiKey(secretAccessKey),
      arkAssetsProjectName: projectName,
    },
  })

  return NextResponse.json({ success: true })
})
