'use client'

import { useEffect, useRef, useState } from 'react'
import type { HomeCopy } from './home-copy'
import { HomeCat } from './HomeCat'
import { HOME_CHANNEL_COLORS, HomeScene } from './HomeScenes'
import { useReducedMotion, useTimecode } from './useHomeMotion'

export function HomeTv({ copy }: { copy: HomeCopy }) {
  const [channel, setChannel] = useState(0)
  const tuned = useRef(false)
  const timecode = useRef<HTMLElement>(null)
  const screen = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState(true)
  const reduced = useReducedMotion()
  useTimecode(timecode, live)
  useEffect(() => {
    const element = screen.current
    if (!element || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(([entry]) => setLive(entry.isIntersecting), { rootMargin: '10% 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return <div className="lm-tv-rig">
    <HomeCat copy={copy} />
    <div className="lm-tv">
      <div ref={screen} className="lm-tv-screen" data-lm-live={live} style={{ '--lm-ch-color': HOME_CHANNEL_COLORS[channel] } as React.CSSProperties} role="img" aria-label={`${copy.illustration}: ${copy.channelNames[channel]}`}>
        <div key={`scene-${channel}`} className={`lm-tv-picture${tuned.current ? ' is-tuning' : ''}`}><HomeScene index={channel} playing={!reduced} /></div>
        <i className="lm-tv-scanlines" aria-hidden="true" /><i className="lm-tv-shine" aria-hidden="true" />
        {tuned.current && !reduced ? <i key={`flash-${channel}`} className="lm-tv-flash" aria-hidden="true" /> : null}
        <div className="lm-tv-osd" aria-hidden="true"><span className="lm-osd-clip"><span key={channel} className="lm-osd-in">{copy.channelCodes[channel]} · {copy.channelNames[channel]}</span></span><span ref={timecode}>00:00:00:00</span></div>
        <div className="lm-tv-controls"><div className="lm-channel-dots">{copy.channelNames.map((name, i) => <button type="button" key={name} className={i === channel ? 'is-active' : ''} style={{ '--lm-ch-color': HOME_CHANNEL_COLORS[i] } as React.CSSProperties} aria-label={`${copy.switchChannel} ${i + 1}: ${name}`} onClick={() => { tuned.current = true; setChannel(i) }} />)}</div><i key={`progress-${channel}`} className="lm-tv-progress" onAnimationEnd={() => { tuned.current = true; setChannel((current) => (current + 1) % 4) }} /></div>
      </div>
      <div className="lm-tv-power" aria-hidden="true"><i /><i /></div>
    </div>
    <i className="lm-tv-glow" style={{ '--lm-ch-color': HOME_CHANNEL_COLORS[channel] } as React.CSSProperties} aria-hidden="true" />
  </div>
}
