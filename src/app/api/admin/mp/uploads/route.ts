import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { uploadObject } from '@/lib/storage'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new ApiError('INVALID_PARAMS', { message: '请选择图片' })
  let jpeg: Buffer
  try {
    jpeg = await sharp(Buffer.from(await file.arrayBuffer())).jpeg({ quality: 90 }).toBuffer()
  } catch {
    throw new ApiError('INVALID_PARAMS', { message: '图片格式不支持' })
  }
  const key = `mp/ops/${randomUUID()}.jpg`
  await uploadObject(jpeg, key, undefined, 'image/jpeg')
  return NextResponse.json({ key })
})
