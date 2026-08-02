import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

async function ownedTemplate(projectId: string, templateId: string, userId: string) {
  const template = await prisma.canvasWorkflowTemplate.findFirst({ where: { id: templateId, projectId, userId } })
  if (!template) throw new ApiError('NOT_FOUND')
  return template
}

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; templateId: string }> },
) => {
  const { projectId, templateId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await ownedTemplate(projectId, templateId, authResult.session.user.id)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 100) : ''
  if (!name) throw new ApiError('INVALID_PARAMS', { message: '请输入工作流名称。' })
  const template = await prisma.canvasWorkflowTemplate.update({ where: { id: templateId }, data: { name } })
  return NextResponse.json({ template })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; templateId: string }> },
) => {
  const { projectId, templateId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await ownedTemplate(projectId, templateId, authResult.session.user.id)
  await prisma.canvasWorkflowTemplate.delete({ where: { id: templateId } })
  return NextResponse.json({ success: true })
})
