'use client'

import { FosShell } from './FosShell'
import { FosMaterialLibrary } from './views/FosMaterialLibrary'

export function FosAssetHubClient() {
  return (
    <FosShell activeKey="assetHub">
      <FosMaterialLibrary />
    </FosShell>
  )
}
