'use client'

import { saveTimeText } from './records'
import './records.css'

/**
 * The first thing a returning viewer sees when the browser holds an automatic save. The stage is
 * not mounted while this card is up, so the video cannot start before the viewer decides.
 */
export function ContinuePrompt({ chapter, node, savedAt, onResume, onRestart }: {
  chapter: string
  node: string
  savedAt: number
  onResume: () => void
  onRestart: () => void
}) {
  return (
    <div className="nori-continue" data-testid="continue-prompt" role="dialog" aria-modal="true" aria-label="继续上次进度">
      <span className="nori-continue-kicker">继续上次进度</span>
      <strong data-testid="continue-where">{chapter} · {node}</strong>
      <small>{saveTimeText(savedAt)}</small>
      <div className="nori-continue-actions">
        <button type="button" className="nori-continue-resume" data-testid="continue-resume" onClick={onResume}>继续</button>
        <button type="button" className="nori-continue-restart" data-testid="continue-restart" onClick={onRestart}>重新开始</button>
      </div>
    </div>
  )
}
