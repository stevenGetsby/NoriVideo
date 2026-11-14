'use client'

import { achievementRewardText } from '@/lib/interactive/achievement-text'
import { StoryIcon } from './StoryIcon'
import type { StoryToast } from './records'
import './records.css'

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" />
      <path d="M12 13v4M9 20h6" />
    </svg>
  )
}

/**
 * One achievement at a time, briefly: icon, name and what it grants. The layer ignores pointer
 * input, so a toast never covers a choice card or a countdown.
 */
export function AchievementToast({ toasts }: { toasts: StoryToast[] }) {
  const toast = toasts[0]
  if (!toast) return null
  const { achievement } = toast
  return (
    <div className="nori-toast-layer" data-testid="achievement-toast-layer" aria-live="polite">
      <div key={toast.id} className="nori-toast" role="status" data-testid="achievement-toast" data-achievement-id={achievement.id}>
        <span className="nori-toast-icon" aria-hidden="true">{achievement.icon ? <StoryIcon icon={achievement.icon} /> : <TrophyIcon />}</span>
        <span className="nori-toast-text">
          <strong>成就达成 · {achievement.name}</strong>
          <em>{achievementRewardText(achievement.reward)}</em>
        </span>
      </div>
    </div>
  )
}
