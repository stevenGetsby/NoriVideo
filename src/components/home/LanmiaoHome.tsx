'use client'

import { useRef } from 'react'
import type { HomeCopy, HomeLocale } from './home-copy'
import { HOME_COPY } from './home-copy'
import { HomeHeader } from './HomeHeader'
import { HomeHero } from './HomeHero'
import { HomeFlow } from './HomeFlow'
import { HomeBento } from './HomeBento'
import { HomeFinale, HomeFooter } from './HomeFinale'
import { HomeChannelDial } from './HomeChannelDial'
import { useEnterStudio, useHomeReveal } from './useHomeMotion'
import '@/styles/lanmiao-home.css'

export type { HomeCopy }

export function LanmiaoHome({ locale, icp }: { locale: HomeLocale; icp: string | null }) {
  const copy = HOME_COPY[locale]
  const rootRef = useRef<HTMLDivElement>(null)
  useHomeReveal(rootRef)
  const enter = useEnterStudio(rootRef)
  return <div ref={rootRef} className="lm-home nori-force-dark" data-lm-ch="01" lang={locale === 'en' ? 'en' : 'zh-CN'}>
    <a className="lm-skip" href="#main">{copy.skip}</a>
    <div className="lm-boot" aria-hidden="true"><i /><i /><b /></div>
    <div className="lm-off" aria-hidden="true"><i /><i /><b /></div>
    <HomeHeader copy={copy} enter={enter} />
    <main id="main"><HomeHero copy={copy} enter={enter} english={locale === 'en'} /><HomeFlow copy={copy} /><HomeBento copy={copy} /><HomeFinale copy={copy} enter={enter} /></main>
    <HomeFooter copy={copy} icp={icp} />
    <HomeChannelDial copy={copy} />
  </div>
}
