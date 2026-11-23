'use client'

import { useEffect, useRef, useState } from 'react'
import { NoriBrandMark } from '@/components/brand/NoriBrandMark'
import type { HomeCopy } from './home-copy'
import { useReducedMotion } from './useHomeMotion'

export function HomeCat({ copy, finale = false }: { copy: HomeCopy; finale?: boolean }) {
  const reduced = useReducedMotion()
  const [pounce, setPounce] = useState(false)
  const [clicks, setClicks] = useState(0)
  const [bubble, setBubble] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])
  useEffect(() => { if (pounce) timers.current.push(setTimeout(() => setPounce(false), 700)) }, [pounce])
  const [action, setAction] = useState(false)
  const tap = () => {
    if (pounce) return
    const count = clicks + 1
    setClicks(count >= 5 ? 0 : count)
    setAction(count >= 5)
    setBubble(true)
    if (!reduced) setPounce(true)
    timers.current.push(setTimeout(() => setBubble(false), 1200))
  }
  return <div className={`lm-cat${finale ? ' lm-cat-finale' : ''}`}>
    <button type="button" className="lm-cat-button" aria-label={copy.cat} onClick={tap}>
      <span className="lm-cat-bob"><span className={`lm-cat-jump${pounce ? ' is-pounce' : ''}`}><NoriBrandMark size={finale ? 168 : 184} alt="" /></span></span>
    </button>
    <span className={`lm-cat-bubble${bubble ? ' is-visible' : ''}`} aria-live="polite">{bubble ? (action ? copy.action : copy.meow) : null}</span>
  </div>
}
