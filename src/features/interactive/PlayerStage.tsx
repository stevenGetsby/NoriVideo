'use client'

import { useEffect, useRef, useState } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { AlertTriangle, ArrowRight, RotateCcw } from '@/components/ui/icons'
import { STORY_ENDING_LABEL } from '@/lib/interactive/compile'
import { choiceTimeoutOption, type StoryStop } from '@/lib/interactive/engine'
import type { StoryMedia } from '@/lib/interactive/types'
import { toDisplayImageUrl } from '@/lib/media/image-url'

const display = (url: string | null | undefined) => (url ? toDisplayImageUrl(url) || url : null)

function StageMedia({ media, onEnded }: { media: StoryMedia | null; onEnded?: () => void }) {
  if (!media) return <div className="nori-player-media is-empty" />
  if (media.kind === 'video') {
    return (
      <video
        key={media.url}
        className="nori-player-media"
        src={display(media.url) ?? undefined}
        poster={display(media.posterUrl) ?? undefined}
        autoPlay
        playsInline
        onEnded={onEnded}
      />
    )
  }
  return <div className="nori-player-media"><MediaImage src={display(media.url) || ''} alt="" fill sizes="80vw" draggable={false} /></div>
}

function Countdown({ seconds, onTimeout }: { seconds: number; onTimeout: () => void }) {
  const [left, setLeft] = useState(seconds)
  const fired = useRef(false)
  const timeoutRef = useRef(onTimeout)
  useEffect(() => { timeoutRef.current = onTimeout }, [onTimeout])
  useEffect(() => {
    const started = performance.now()
    const timer = window.setInterval(() => {
      const next = Math.max(0, seconds - (performance.now() - started) / 1000)
      setLeft(next)
      if (next <= 0 && !fired.current) {
        fired.current = true
        window.clearInterval(timer)
        timeoutRef.current()
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [seconds])
  return (
    <div className="nori-player-countdown" aria-label={`剩余 ${Math.ceil(left)} 秒`}>
      <i style={{ width: `${(left / seconds) * 100}%` }} />
      <span>{Math.ceil(left)}s</span>
    </div>
  )
}

export function PlayerStage({ stop, stepKey, backdrop, orientation, onContinue, onChoose, onRestart, onLocate }: {
  stop: StoryStop
  stepKey: string
  backdrop: StoryMedia | null
  orientation: 'portrait' | 'landscape'
  onContinue: () => void
  onChoose: (optionId: string) => void
  onRestart: () => void
  onLocate?: (projectId: string, nodeId: string) => void
}) {
  if (stop.kind === 'scene') {
    const { node } = stop
    return (
      <>
        <StageMedia media={node.media} onEnded={onContinue} />
        {!node.media ? <div className="nori-player-placeholder"><strong>{node.title}</strong><span>这段剧情还没有画面</span></div> : null}
        {node.lines ? <p className="nori-player-subtitle">{node.lines}</p> : null}
        <button type="button" className="nori-player-continue" onClick={onContinue}>继续<ArrowRight /></button>
      </>
    )
  }
  if (stop.kind === 'choice') {
    const { node } = stop
    return (
      <>
        <StageMedia media={backdrop} />
        <div className={`nori-player-choice is-${orientation}`}>
          {node.timeoutSec ? <Countdown key={stepKey} seconds={node.timeoutSec} onTimeout={() => {
            const fallback = choiceTimeoutOption(node)
            if (fallback) onChoose(fallback)
          }} /> : null}
          {node.prompt ? <p className="nori-player-prompt">{node.prompt}</p> : null}
          <div className="nori-player-options">
            {node.options.map((option, index) => (
              <button key={option.id} type="button" onClick={() => onChoose(option.id)}>{option.label || `选项${index + 1}`}</button>
            ))}
          </div>
        </div>
      </>
    )
  }
  if (stop.kind === 'ending') {
    const { node } = stop
    return (
      <>
        <StageMedia media={backdrop} />
        <div className={`nori-player-card is-ending is-${node.endingType}`}>
          <span>{STORY_ENDING_LABEL[node.endingType]}</span>
          <strong>{node.title}</strong>
          {node.description ? <p>{node.description}</p> : null}
          <button type="button" onClick={onRestart}><RotateCcw />重新开始</button>
        </div>
      </>
    )
  }
  if (stop.kind === 'exit') {
    return (
      <>
        <StageMedia media={backdrop} />
        <div className="nori-player-card">
          <span>本章结束</span>
          <strong>到达出口「{stop.node.title}」</strong>
          <p>全剧试玩时会从这里进入下一章。</p>
          <button type="button" onClick={onRestart}><RotateCcw />重新开始</button>
        </div>
      </>
    )
  }
  return (
    <div className="nori-player-card is-halt">
      <AlertTriangle />
      <strong>试玩中断</strong>
      <p>{stop.message}</p>
      <div>
        {onLocate && stop.projectId && stop.nodeId ? <button type="button" onClick={() => onLocate(stop.projectId!, stop.nodeId!)}>定位到节点</button> : null}
        <button type="button" onClick={onRestart}><RotateCcw />重新开始</button>
      </div>
    </div>
  )
}
