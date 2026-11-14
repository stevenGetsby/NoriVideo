import React from 'react'
import { createRoot } from 'react-dom/client'
import { InteractivePlayer } from '../../src/features/interactive/InteractivePlayer'
import type { StoryAspectRatio, StoryProgram, StoryVariable } from '../../src/lib/interactive/types'
import '../../src/features/interactive/interactive.css'
import { vaultStory } from '../unit/interactive/economy-fixture'

const CLIP = '/story-clip.webm'

type Scenario = { program: StoryProgram; aspectRatio: StoryAspectRatio; storageKey?: string }

function withClip(program: StoryProgram): StoryProgram {
  return {
    ...program,
    chapters: program.chapters.map((chapter) => ({
      ...chapter,
      nodes: chapter.nodes.map((node) => (node.kind === 'scene' && node.media?.kind === 'video'
        ? { ...node, media: { ...node.media, url: CLIP, posterUrl: null } }
        : node)),
    })),
  }
}

function withVariables(program: StoryProgram, patch: Record<string, Partial<StoryVariable>>): StoryProgram {
  return { ...program, variables: program.variables.map((variable) => (patch[variable.id] ? { ...variable, ...patch[variable.id] } : variable)) }
}

/** The same vault story used by the engine tests, with a per-scenario shop / values / storage scope. */
function scenarioOf(name: string): Scenario {
  switch (name) {
    case 'vault':
      return { program: withClip(vaultStory()), aspectRatio: '9:16' }
    case 'vault-rich':
      return { program: withClip(withVariables(vaultStory(), { coin: { initial: 8 } })), aspectRatio: '9:16', storageKey: 'economy-rich' }
    case 'vault-timed':
      return { program: withClip(vaultStory({ door: { timeoutSec: 4, defaultOptionId: 'o_open' } })), aspectRatio: '9:16' }
    case 'vault-seeded':
      return {
        program: withClip(withVariables(vaultStory(), { brave: { showInHud: true, icon: '💪' } })),
        aspectRatio: '9:16',
        storageKey: 'economy-seeded',
      }
    case 'vault-bare':
      return { program: withClip(withVariables(vaultStory(), { brave: { showInHud: true, icon: '💪' } })), aspectRatio: '9:16' }
    case 'vault-hint':
      return {
        program: withClip(vaultStory({
          door: {
            options: [
              { id: 'o_push', label: '硬闯' },
              {
                id: 'o_wait',
                label: '等一等',
                unlock: { mode: 'locked', match: 'all', conditions: [{ variableId: 'key', op: '>=', value: 1 }], shopItemId: null },
              },
            ],
          },
        })),
        aspectRatio: '9:16',
      }
    case 'vault-landscape':
      return { program: withClip(vaultStory()), aspectRatio: '16:9' }
    default:
      throw new Error(`unknown scenario ${name}`)
  }
}

const name = new URLSearchParams(window.location.search).get('scenario') || 'empty'

function App() {
  if (name === 'empty') return <div id="empty" />
  const scenario = scenarioOf(name)
  return (
    <InteractivePlayer
      program={scenario.program}
      mode="story"
      aspectRatio={scenario.aspectRatio}
      title={`试玩 ${name}`}
      storageKey={scenario.storageKey}
      onClose={() => {}}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)
