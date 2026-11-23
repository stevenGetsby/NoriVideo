export type AccountContentRestriction = 'story-canvas' | 'asset-library'

/** Existing permission JSON is also the store for explicit, per-account restrictions. */
export function readAccountContentRestrictions(permissions: unknown): AccountContentRestriction[] {
  if (!Array.isArray(permissions)) return []
  const restrictions: AccountContentRestriction[] = []
  if (permissions.includes('deny:story-canvas')) restrictions.push('story-canvas')
  if (permissions.includes('deny:asset-library')) restrictions.push('asset-library')
  return restrictions
}

export function accountApiContentRestriction(pathname: string | undefined): AccountContentRestriction | undefined {
  if (!pathname) return
  if (/^\/api\/interactive(?:\/|$)/i.test(pathname)) return 'story-canvas'
  if (/^\/api\/(?:assets|asset-hub|frameos\/materials)(?:\/|$)/i.test(pathname)) return 'asset-library'
}
