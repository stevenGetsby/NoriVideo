'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import { useLocale } from 'next-intl'
import { ArrowUpRight, Clapperboard, Layers3, PenLine, Sparkles } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { AuthHelpButton } from './auth/AuthHelpButton'
import { NoriBrandMark } from '@/components/brand/NoriBrandMark'

export function FosAuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  const english = useLocale() === 'en'
  const workflow = english
    ? [{ icon: PenLine, title: 'Story', detail: 'An idea takes shape' }, { icon: Layers3, title: 'World', detail: 'Make it your own' }, { icon: Clapperboard, title: 'Film', detail: 'Bring it to life' }]
    : [{ icon: PenLine, title: '故事构建', detail: '让灵感落笔' }, { icon: Layers3, title: '资产创作', detail: '让世界成形' }, { icon: Clapperboard, title: '镜头叙事', detail: '让故事发生' }]

  return (
    <main className="nori-auth">
      <div className="nori-auth-ambient" aria-hidden="true" />
      <header className="nori-auth-header">
        <Link href={{ pathname: '/' }} className="nori-auth-brand" aria-label="NoriVideo">
          <NoriBrandMark size={38} className="nori-auth-brand-cat" />
          <span><span className="nori-auth-brand-name">Nori</span><span className="nori-auth-brand-light">Video</span><sup>STUDIO</sup></span>
        </Link>
        <span className="nori-auth-header-label">{english ? 'A SPACE FOR YOUR NEXT STORY' : '为每一个好故事而生'}</span>
        <div className="nori-auth-header-actions">
          <AuthHelpButton label={english ? 'Getting started' : '使用指南'} />
          <a href="#workspace-signin" className="nori-auth-header-enter" onClick={(event) => {
            event.preventDefault()
            document.getElementById('workspace-signin')?.scrollIntoView({
              block: 'center',
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            })
            document.getElementById('username')?.focus({ preventScroll: true })
          }}>{english ? 'Your workspace' : '进入工作台'}<ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
      </header>

      <div className="nori-auth-layout">
        <section className="nori-auth-story" aria-labelledby="nori-auth-story-title">
          <p className="nori-auth-eyebrow"><Sparkles size={13} aria-hidden="true" /><span>THE NEXT SCENE IS YOURS</span><span className="nori-auth-eyebrow-line" /></p>
          <h1 id="nori-auth-story-title">
            {english ? <>Every story.<br /><span>A world of possibilities.</span></> : <>让想象，<br /><span>成为下一幕。</span></>}
          </h1>
          <p className="nori-auth-story-description">{english
            ? 'From the first spark to the final frame. One workspace for your story, your team, and everything in between.'
            : '从第一行灵感，到最后一帧画面。把故事、资产与镜头，连接成你的下一部作品。'}</p>

          <figure className="nori-auth-cinema">
            <Image
              src="/auth/cinematic-landscape.webp"
              alt={english ? 'Snow-covered mountain peaks under a clouded sky' : '阴云下，层叠雪山与山谷向远处延伸'}
              fill
              priority
              unoptimized
              sizes="(max-width: 900px) 100vw, 58vw"
            />
            <div className="nori-auth-cinema-shade" aria-hidden="true" />
            <span className="nori-auth-frame-corner is-top-left" aria-hidden="true" />
            <span className="nori-auth-frame-corner is-top-right" aria-hidden="true" />
            <span className="nori-auth-frame-corner is-bottom-left" aria-hidden="true" />
            <span className="nori-auth-frame-corner is-bottom-right" aria-hidden="true" />
            <div className="nori-auth-scene-top"><span><i aria-hidden="true" />VISUAL INSPIRATION</span><span>01 / ∞</span></div>
            <figcaption>
              <span className="nori-auth-scene-index">A STORY WAITING TO HAPPEN</span>
              <strong>{english ? 'Somewhere beyond the ordinary.' : '每一个故事，都有自己的远方。'}</strong>
              <span className="nori-auth-scene-note">{english ? 'Imagine it. Make it yours.' : '故事尚未开始，想象已经抵达。'}</span>
            </figcaption>
            <div className="nori-auth-scene-format" aria-hidden="true"><span>FRAME 001</span><span className="nori-auth-scene-cross">+</span></div>
          </figure>

          <div className="nori-auth-workflow" aria-label={english ? 'Creative workflow' : '创作流程'}>
            {workflow.map(({ icon: Icon, title: itemTitle, detail }, index) => (
              <div className="nori-auth-workflow-item" key={itemTitle}>
                <span className="nori-auth-workflow-icon"><Icon size={16} strokeWidth={1.5} aria-hidden="true" /></span>
                <div><strong>{itemTitle}</strong><span>{detail}</span></div>
                {index < workflow.length - 1 ? <span className="nori-auth-workflow-connector" aria-hidden="true">→</span> : null}
              </div>
            ))}
          </div>
        </section>

        <section id="workspace-signin" tabIndex={-1} className="nori-auth-access" aria-labelledby="nori-auth-access-title">
          <div className="nori-auth-card">
            <div className="nori-auth-card-kicker"><span aria-hidden="true" /><span>YOUR CREATIVE WORKSPACE</span></div>
            <h2 id="nori-auth-access-title">{title}</h2>
            <p className="nori-auth-card-description">{subtitle}</p>
            <div className="nori-auth-card-content">{children}</div>
            <div className="nori-auth-card-footer">{footer}</div>
          </div>
          <p className="nori-auth-access-note"><span aria-hidden="true" /><span>{english ? 'Your stories. Your team. Your own space.' : '独立工作区，让创作与协作井然有序。'}</span></p>
        </section>
      </div>

      <footer className="nori-auth-footer">
        <span>© {new Date().getFullYear()} NoriVideo</span>
        <span className="nori-auth-footer-center">{english ? 'MADE FOR STORIES. BUILT FOR CREATORS.' : '故事，由你定义。'}</span>
        <span>IMAGINE. CREATE. TOGETHER.</span>
      </footer>
    </main>
  )
}
