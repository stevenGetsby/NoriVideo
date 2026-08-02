import { describe, expect, it } from 'vitest'
import {
  API_HANDLER_ALLOWLIST,
  PUBLIC_ROUTE_ALLOWLIST,
  inspectRouteContract,
} from '../../../scripts/guards/api-route-contract-guard.mjs'

describe('api route contract guard', () => {
  it('allows explicit public and framework-managed exceptions', () => {
    expect(API_HANDLER_ALLOWLIST.has('src/app/api/auth/[...nextauth]/route.ts')).toBe(true)
    expect(PUBLIC_ROUTE_ALLOWLIST.has('src/app/api/system/boot-id/route.ts')).toBe(false)
    expect(
      inspectRouteContract(
        'src/app/api/system/boot-id/route.ts',
        'export async function GET() { return Response.json({ bootId: "x" }) }',
      ),
    ).toEqual([
      'src/app/api/system/boot-id/route.ts missing apiHandler wrapper',
      'src/app/api/system/boot-id/route.ts missing requireUserAuth/requireUserPermission/requireProjectAuth/requireProjectAuthLight',
    ])
  })

  it('passes protected routes that use apiHandler and explicit auth', () => {
    const content = `
      import { requireUserAuth } from '@/lib/api-auth'
      import { apiHandler } from '@/lib/api-errors'
      export const GET = apiHandler(async () => {
        await requireUserAuth()
        return Response.json({ ok: true })
      })
    `

    expect(inspectRouteContract('src/app/api/user/secure/route.ts', content)).toEqual([])

    const adminContent = `
      import { requireAdminAuth } from '@/lib/api-auth'
      import { apiHandler } from '@/lib/api-errors'
      export const GET = apiHandler(async () => {
        await requireAdminAuth()
        return Response.json({ ok: true })
      })
    `
    expect(inspectRouteContract('src/app/api/admin/accounts/route.ts', adminContent)).toEqual([])

    const superAdminContent = `
      import { requireSuperAdminAuth } from '@/lib/api-auth'
      import { apiHandler } from '@/lib/api-errors'
      export const GET = apiHandler(async () => {
        await requireSuperAdminAuth()
        return Response.json({ ok: true })
      })
    `
    expect(inspectRouteContract('src/app/api/admin/services/route.ts', superAdminContent)).toEqual([])

    const permissionContent = `
      import { requireUserPermission } from '@/lib/api-auth'
      import { apiHandler } from '@/lib/api-errors'
      export const PATCH = apiHandler(async () => {
        await requireUserPermission(['assetWrite'])
        return Response.json({ ok: true })
      })
    `
    expect(inspectRouteContract('src/app/api/frameos/materials/[materialId]/route.ts', permissionContent)).toEqual([])
  })

  it('recognizes the authenticated collaboration assignment route delegate', () => {
    const content = `
      import { apiHandler } from '@/lib/api-errors'
      import { handleAssignmentGet } from '@/lib/collaboration/assignment-http'
      export const GET = apiHandler((request) => handleAssignmentGet(request, 'my'))
    `

    expect(inspectRouteContract('src/app/api/collaboration/assignments/my/route.ts', content)).toEqual([])
  })

  it('flags protected routes that skip apiHandler or auth', () => {
    const missingApiHandler = `
      import { requireUserAuth } from '@/lib/api-auth'
      export async function GET() {
        await requireUserAuth()
        return Response.json({ ok: true })
      }
    `
    const missingAuth = `
      import { apiHandler } from '@/lib/api-errors'
      export const GET = apiHandler(async () => Response.json({ ok: true }))
    `

    expect(inspectRouteContract('src/app/api/user/secure/route.ts', missingApiHandler)).toEqual([
      'src/app/api/user/secure/route.ts missing apiHandler wrapper',
    ])
    expect(inspectRouteContract('src/app/api/user/secure/route.ts', missingAuth)).toEqual([
      'src/app/api/user/secure/route.ts missing requireUserAuth/requireUserPermission/requireProjectAuth/requireProjectAuthLight',
    ])
  })
})
