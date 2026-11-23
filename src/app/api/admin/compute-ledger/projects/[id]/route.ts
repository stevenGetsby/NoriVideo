import { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { archiveLedgerProject, patchLedgerProject, type LedgerProjectInput } from '@/lib/compute-ledger/projects'
import { json, adminLedgerCtx } from '@/lib/compute-ledger/route-helpers'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  if (typeof body.archived === 'boolean') {
    const updated = await archiveLedgerProject(auth.ctx, id, body.archived)
    return json({ id: updated.id, archivedAt: updated.archivedAt ? updated.archivedAt.toISOString() : null })
  }

  const patch: LedgerProjectInput = {}
  if ('name' in body) patch.name = typeof body.name === 'string' ? body.name : ''
  if ('category' in body) patch.category = (body.category ?? null) as LedgerProjectInput['category']
  if ('status' in body) patch.status = body.status as LedgerProjectInput['status']
  if ('startDate' in body) patch.startDate = (body.startDate ?? null) as string | null
  if ('targetDeliveryDate' in body) patch.targetDeliveryDate = (body.targetDeliveryDate ?? null) as string | null
  if ('budgetCny' in body) patch.budgetCny = (body.budgetCny ?? null) as number | null
  if ('durationMinutes' in body) patch.durationMinutes = (body.durationMinutes ?? null) as number | null
  if ('totalEpisodes' in body) patch.totalEpisodes = (body.totalEpisodes ?? null) as number | null
  if ('doneEpisodes' in body) patch.doneEpisodes = (body.doneEpisodes ?? null) as number | null
  if ('note' in body) patch.note = typeof body.note === 'string' ? body.note : null
  const updated = await patchLedgerProject(auth.ctx, id, patch)
  return json({ id: updated.id, name: updated.name, status: updated.status })
})
