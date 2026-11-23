'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, RefObject } from 'react'
import { useRouter } from '@/i18n/navigation'

type RootRef = RefObject<HTMLDivElement | null>
type HeroRef = RefObject<HTMLElement | null>
export type HomeEnter = {
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void
  onPointerEnter: () => void
  onFocus: () => void
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useHomeReveal(rootRef: RootRef) {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !('IntersectionObserver' in window)) return
    const sections = Array.from(root.querySelectorAll<HTMLElement>('section[data-ch]'))
    const reveals = Array.from(root.querySelectorAll<HTMLElement>('[data-lm-reveal]'))
    for (const element of reveals) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom >= 0 && rect.top <= window.innerHeight) element.classList.add('is-in')
    }
    root.setAttribute('data-lm-js', '')
    const liveObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) (entry.target as HTMLElement).setAttribute('data-lm-live', String(entry.isIntersecting))
    }, { threshold: 0, rootMargin: '10% 0px' })
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) (entry.target as HTMLElement).classList.add('is-in')
      const center = window.innerHeight / 2
      const current = sections.find((section) => {
        const rect = section.getBoundingClientRect()
        return rect.top <= center && rect.bottom >= center
      })
      if (current?.dataset.ch) root.setAttribute('data-lm-ch', current.dataset.ch)
    }, { threshold: [0, 0.15], rootMargin: '10% 0px' })
    for (const element of sections) liveObserver.observe(element)
    for (const element of [...sections, ...reveals]) revealObserver.observe(element)
    const onScroll = () => {
      const center = window.innerHeight / 2
      const current = sections.find((section) => {
        const rect = section.getBoundingClientRect()
        return rect.top <= center && rect.bottom >= center
      })
      if (current?.dataset.ch) root.setAttribute('data-lm-ch', current.dataset.ch)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { liveObserver.disconnect(); revealObserver.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [rootRef])
}

export function useHeaderScroll() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const update = () => ref.current?.classList.toggle('is-scrolled', window.scrollY > 24)
    window.addEventListener('scroll', update, { passive: true })
    update()
    return () => window.removeEventListener('scroll', update)
  }, [])
  return ref
}

export function usePointerTilt(heroRef: HeroRef) {
  useEffect(() => {
    const hero = heroRef.current
    if (!hero || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let frame = 0
    let pending = { x: 0, y: 0 }
    const apply = () => {
      frame = 0
      hero.style.setProperty('--lm-px', String(pending.x))
      hero.style.setProperty('--lm-py', String(pending.y))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply) }
    const onMove = (event: PointerEvent) => {
      if (prefersReducedMotion()) return
      const rect = hero.getBoundingClientRect()
      pending = { x: (event.clientX - rect.left) / rect.width * 2 - 1, y: (event.clientY - rect.top) / rect.height * 2 - 1 }
      schedule()
    }
    const onLeave = () => { pending = { x: 0, y: 0 }; schedule() }
    hero.addEventListener('pointermove', onMove)
    hero.addEventListener('pointerleave', onLeave)
    return () => { hero.removeEventListener('pointermove', onMove); hero.removeEventListener('pointerleave', onLeave); if (frame) cancelAnimationFrame(frame) }
  }, [heroRef])
}

export function useTimecode(ref: RefObject<HTMLElement | null>, live: boolean) {
  useEffect(() => {
    const element = ref.current
    if (!element || !live || prefersReducedMotion()) { if (element) element.textContent = '00:00:00:00'; return }
    const started = performance.now()
    let frame = 0
    let last = -1
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - started)
      const bucket = Math.floor(elapsed / 83)
      if (bucket !== last) {
        last = bucket
        const seconds = Math.floor(elapsed / 1000)
        const pad = (value: number) => String(value).padStart(2, '0')
        element.textContent = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(Math.floor(elapsed % 1000 / 1000 * 24))}`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [live, ref])
}

export function useEnterStudio(rootRef: RootRef): HomeEnter {
  const router = useRouter()
  const leaving = useRef(false)
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigation = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const root = rootRef.current
    const restore = () => { leaving.current = false; root?.removeAttribute('data-lm-leaving') }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) restore() }
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      if (fallback.current) clearTimeout(fallback.current)
      if (navigation.current) clearTimeout(navigation.current)
    }
  }, [rootRef])
  const prefetch = () => { router.prefetch({ pathname: '/auth/signin' }) }
  return {
    onPointerEnter: prefetch,
    onFocus: prefetch,
    onClick: (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || prefersReducedMotion()) return
      event.preventDefault()
      if (leaving.current) return
      leaving.current = true
      rootRef.current?.setAttribute('data-lm-leaving', '')
      fallback.current = setTimeout(() => { leaving.current = false; rootRef.current?.removeAttribute('data-lm-leaving') }, 4480)
      navigation.current = setTimeout(() => { router.push({ pathname: '/auth/signin' }) }, 480)
    },
  }
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}
