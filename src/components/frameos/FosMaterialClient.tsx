'use client'

import { FosShell } from './FosShell'
import { FosMaterialLibrary } from './views/FosMaterialLibrary'

export function FosMaterialClient() {
  return (
    <FosShell activeKey="material">
      <FosMaterialLibrary />
    </FosShell>
  )
}
