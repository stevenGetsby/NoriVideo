'use client'

import { FosShell } from './FosShell'
import { FosScreenwriter } from './views/FosScreenwriter'

export function FosScreenwriterClient() {
  return (
    <FosShell activeKey="screenwriter">
      <FosScreenwriter />
    </FosShell>
  )
}
