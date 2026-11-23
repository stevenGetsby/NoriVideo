import { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { createLedgerProject, type LedgerProjectInput } from '@/lib/compute-ledger/projects'
import { json, adminLedgerCtx } from '@/lib/compute-ledger/route-helpers'

export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const input: LedgerProjectInput = {
    name: typeof body.name === 'string' ? body.name : undefined,
    workId: typeof body.workId === 'string' && body.workId.trim() ? body.workId.trim() : null,
    category: (body.category ?? null) as LedgerProjectInput['category'],
    status: body.status as LedgerProjectInput['status'],
    startDate: (body.startDate ?? null) as string | null,
    targetDeliveryDate: (body.targetDeliveryDate ?? null) as string | null,
    budgetCny: (body.budgetCny ?? null) as number | null,
    durationMinutes: (body.durationMinutes ?? null) as number | null,
    totalEpisodes: (body.totalEpisodes ?? null) as number | null,
    doneEpisodes: (body.doneEpisodes ?? null) as number | null,
    note: typeof body.note === 'string' ? body.note : null,
  }
  const project = await createLedgerProject(auth.ctx, input)
  return json({ id: project.id, name: project.name, workId: project.workId })
})
