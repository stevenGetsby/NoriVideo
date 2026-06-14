import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { getSeedanceAssetsConfig } from '@/lib/volcengine/seedance-assets-config'
import { SeedanceAssetsClient } from '@/lib/volcengine/seedance-assets-client'

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function countGroups(result: Awaited<ReturnType<SeedanceAssetsClient['listAssetGroups']>>): number | null {
  const groups = result.AssetGroups || result.Groups || result.Items
  return Array.isArray(groups) ? groups.length : null
}

function readTotal(result: Awaited<ReturnType<SeedanceAssetsClient['listAssetGroups']>>): number | null {
  if (typeof result.Total === 'number' && Number.isFinite(result.Total)) return result.Total
  if (typeof result.TotalCount === 'number' && Number.isFinite(result.TotalCount)) return result.TotalCount
  return null
}

export const POST = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const startedAt = Date.now()
  let configured = false
  try {
    const config = await getSeedanceAssetsConfig(authResult.session.user.id)
    configured = true
    const result = await new SeedanceAssetsClient(config).listAssetGroups({
      projectName: config.projectName,
      pageSize: 1,
    })

    return NextResponse.json({
      success: true,
      configured: true,
      projectName: config.projectName,
      latencyMs: Date.now() - startedAt,
      assetGroupCount: countGroups(result),
      totalAssetGroupCount: readTotal(result),
    })
  } catch (error) {
    const message = readErrorMessage(error)
    const configMissing = message.includes('SEEDANCE_ASSETS_CONFIG_REQUIRED')
    return NextResponse.json({
      success: false,
      configured: configured && !configMissing,
      code: configMissing ? 'SEEDANCE_ASSETS_CONFIG_REQUIRED' : 'SEEDANCE_ASSETS_PROBE_FAILED',
      message: configMissing
        ? 'Seedance asset credentials are not configured.'
        : 'Seedance asset library probe failed.',
      latencyMs: Date.now() - startedAt,
    })
  }
})
