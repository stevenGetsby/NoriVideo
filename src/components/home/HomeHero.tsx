'use client'

import { useRef } from 'react'
import { ArrowUpRight } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import type { HomeCopy } from './home-copy'
import { HomeHeadline } from './HomeHeadline'
import { HomeTv } from './HomeTv'
import type { HomeEnter } from './useHomeMotion'
import { usePointerTilt } from './useHomeMotion'

function ArrowDown() {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function Marquee({ reverse = false }: { reverse?: boolean }) {
  return <div className={`lm-marquee${reverse ? ' lm-marquee-reverse' : ''}`} aria-hidden="true"><div><span>LANMIAO TV ✦ JUMP CUT ✦ ACTION ✦ 喵 ✦ </span><span>LANMIAO TV ✦ JUMP CUT ✦ ACTION ✦ 喵 ✦ </span></div></div>
}

export function HomeHero({ copy, enter, english }: { copy: HomeCopy; enter: HomeEnter; english: boolean }) {
  const ref = useRef<HTMLElement>(null)
  usePointerTilt(ref)
  return <section ref={ref} id="top" className={`lm-hero${english ? ' lm-english' : ''}`} data-ch="01" aria-labelledby="lm-hero-title">
    <div className="lm-ambient" aria-hidden="true"><i /><i /><i /></div><i className="lm-pointer-light" aria-hidden="true" /><Marquee /><Marquee reverse />
    <div className="lm-hero-inner">
      <div className="lm-hero-copy"><p className="lm-eyebrow" aria-hidden="true"><i />{copy.heroEyebrow}</p><HomeHeadline lines={copy.headlineLines} label={copy.headline} english={english} /><p className="lm-hero-description">{copy.description}</p><div className="lm-hero-actions"><Link className="lm-button lm-button-primary" href={{ pathname: '/auth/signin' }} data-lm-enter data-testid="home-enter" {...enter}>{copy.enter}<ArrowUpRight size={18} /></Link><a className="lm-text-link" href="#flow">{copy.seeFlow}<ArrowDown /></a></div></div>
      <HomeTv copy={copy} />
    </div>
  </section>
}
