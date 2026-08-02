import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import {
  createWorkflowTemplateStudioDocumentsInTransaction,
  withStudioDocumentSource,
  workflowTemplateStudioDocumentSource,
} from '@/lib/canvas/studio-document-lifecycle'
import { prisma } from '@/lib/prisma'

function text(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function templateDocument(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) return null
  if (source.nodes.length < 1 || source.nodes.length > 500 || source.edges.length > 4_000) return null
  const serialized = JSON.stringify({ nodes: source.nodes, edges: source.edges })
  if (serialized.length > 2_000_000) return null
  return JSON.parse(serialized) as { nodes: unknown[]; edges: unknown[] }
}

function templateResponse<T extends {
  id: string
  nodes: unknown
  studioDocuments: Array<{ sourceNodeId: string }>
}>(template: T) {
  const { studioDocuments, ...row } = template
  const documentedNodeIds = new Set(studioDocuments.map((item) => item.sourceNodeId))
  const nodes = Array.isArray(row.nodes)
    ? row.nodes.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value
        const node = value as { id?: unknown; type?: unknown; data?: unknown }
        if (
          node.type !== 'studio_3d'
          || typeof node.id !== 'string'
          || !documentedNodeIds.has(node.id)
        ) return value
        return withStudioDocumentSource(
          node as { id: string; type: string; data?: unknown },
          workflowTemplateStudioDocumentSource(template.id, node.id),
        )
      })
    : []
  return { ...row, nodes }
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const templates = await prisma.canvasWorkflowTemplate.findMany({
    where: { projectId, userId: authResult.session.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      studioDocuments: { select: { sourceNodeId: true } },
    },
  })
  return NextResponse.json({ templates: templates.map(templateResponse) })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const name = text(body?.name).slice(0, 100)
  const document = templateDocument(body?.document)
  if (!name || !document) throw new ApiError('INVALID_PARAMS', { message: '工作流名称或节点数据无效。' })
  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.canvasWorkflowTemplate.create({
      data: {
        projectId,
        userId: authResult.session.user.id,
        name,
        nodes: document.nodes as Prisma.InputJsonValue,
        edges: document.edges as Prisma.InputJsonValue,
      },
    })
    await createWorkflowTemplateStudioDocumentsInTransaction(tx, {
      templateId: created.id,
      projectId,
      templateOwnerId: authResult.session.user.id,
      nodes: document.nodes.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const node = value as Record<string, unknown>
        return typeof node.id === 'string' && typeof node.type === 'string'
          ? [{ id: node.id, type: node.type, data: node.data }]
          : []
      }),
    })
    return created
  })
  return NextResponse.json({ template }, { status: 201 })
})
