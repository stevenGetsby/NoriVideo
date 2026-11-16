import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InteractivePlayer } from '@/features/interactive/InteractivePlayer'
import type { StoryProgram } from '@/lib/interactive/types'
// @ts-ignore injected at runtime
declare const __PROGRAM__: StoryProgram

export default function Fixture() {
  const [open, setOpen] = useState(true)
  const program: StoryProgram = __PROGRAM__
  if (!open) return <button type="button" onClick={() => setOpen(true)}>reopen</button>
  return (
    <InteractivePlayer
      program={program}
      mode="story"
      aspectRatio="16:9"
      title="影游试玩复现"
      onClose={() => setOpen(false)}
    />
  )
}

function boot() {
  const rootEl = document.getElementById('root')
  if (!rootEl) {
    setTimeout(boot, 0)
    return
  }
  createRoot(rootEl).render(<Fixture />)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
