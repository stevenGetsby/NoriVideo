'use client'

import { useEffect, useState } from 'react'
import { effectiveViewport, isCompactViewport, stageTurnFor, type StageTurn } from './stage-orientation'

export interface StageViewport {
  /** Quarter turns clockwise the whole player frame is rotated. */
  turn: StageTurn
  /** Too short for the header and side panel: the picture goes immersive. */
  compact: boolean
  /** The real screen, before any turn. */
  width: number
  height: number
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  const visual = window.visualViewport
  return {
    width: Math.round(visual?.width ?? window.innerWidth),
    height: Math.round(visual?.height ?? window.innerHeight),
  }
}

/** Tracks the visual viewport so the player can turn or go immersive on phones, including in-app browsers. */
export function useStageViewport(landscapeWork: boolean): StageViewport {
  const [size, setSize] = useState(viewportSize)

  useEffect(() => {
    const update = () => setSize(viewportSize())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  const turn = stageTurnFor(landscapeWork, size.width, size.height)
  const view = effectiveViewport(size.width, size.height, turn)
  return { turn, compact: isCompactViewport(view.width, view.height), width: size.width, height: size.height }
}
