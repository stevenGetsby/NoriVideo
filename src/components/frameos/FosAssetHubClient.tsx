'use client'

import { FosShell } from './FosShell'
import { FosAssetLibrary } from './views/FosAssetLibrary'

export function FosAssetHubClient() {
  return (
    <FosShell activeKey="assetHub">
      <FosAssetLibrary />
    </FosShell>
  )
}
