'use client'

import type { ReactNode } from 'react'
import { X } from '@/components/ui/icons'
import './records.css'

/**
 * The shared sheet shell of the player: a bottom sheet in portrait, a centred panel in landscape,
 * exactly like the shop. Esc and the backdrop are owned by the player; this only draws the frame.
 */
export function SheetShell({ title, orientation, testId, ariaLabel, onClose, head, children }: {
  title: string
  orientation: 'portrait' | 'landscape'
  testId: string
  ariaLabel: string
  onClose: () => void
  head?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={`nori-records is-${orientation}`} data-testid={testId} role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <button type="button" className="nori-records-backdrop" aria-label={`关闭${ariaLabel}`} onClick={onClose} />
      <section className="nori-records-panel">
        <header className="nori-records-head">
          <h3>{title}</h3>
          {head}
          <button type="button" className="nori-records-close" aria-label={`关闭${ariaLabel}`} data-testid={`${testId}-close`} onClick={onClose}><X /></button>
        </header>
        {children}
      </section>
    </div>
  )
}
