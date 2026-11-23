import { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import type { EntryKind } from '@/lib/compute-ledger/calc'
import { replaceEntry, voidEntry, type CreateEntryInput } from '@/lib/compute-ledger/entries'
import { json, memberLedgerCtx } from '@/lib/compute-ledger/route-helpers'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const session = await requireUserAuth()
  if (isErrorResponse(session)) return session
  const auth = memberLedgerCtx(session.session)
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const input: CreateEntryInput = {
    ledgerProjectId: typeof body.ledgerProjectId === 'string' ? body.ledgerProjectId : '',
    dateKey: typeof body.dateKey === 'string' ? body.dateKey : '',
    kind: body.kind as EntryKind,
    quantity: body.quantity as number,
    remark: typeof body.remark === 'string' ? body.remark : null,
    actorUserId: typeof body.actorUserId === 'string' ? body.actorUserId : null,
    confirmLarge: body.confirmLarge === true,
  }
  return json(await replaceEntry(auth.ctx, id, input))
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const session = await requireUserAuth()
  if (isErrorResponse(session)) return session
  const auth = memberLedgerCtx(session.session)
  const { id } = await context.params
  return json(await voidEntry(auth.ctx, id))
})
