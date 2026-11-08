import React from 'react'
import { createRoot } from 'react-dom/client'
import { StoryOverview } from '../../src/features/interactive/StoryOverview'
import { StoryProductionCanvas } from '../../src/features/interactive/StoryProductionCanvas'
import { StoryWorksCanvas } from '../../src/features/interactive/StoryWorksCanvas'
import '../../src/styles/frameos-replica.css'
import '../../src/features/interactive/interactive.css'

const path = window.location.pathname.replace(/\/+$/, '')
const match = path.match(/\/interactive\/([^/]+)(?:\/(works|production))?$/)

function App() {
  if (match) {
    const workId = decodeURIComponent(match[1])
    if (match[2] === 'works') return <StoryWorksCanvas workId={workId} />
    if (match[2] === 'production') return <StoryProductionCanvas workId={workId} />
    return <StoryOverview workId={workId} />
  }
  return <div data-testid="fixture-other">{path}</div>
}

createRoot(document.getElementById('root')!).render(<App />)
