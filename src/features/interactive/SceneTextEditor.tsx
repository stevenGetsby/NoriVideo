'use client'

import { useId } from 'react'
import { fitSceneTextRows, sceneTextMetrics, SCENE_TEXT_MAX } from '@/lib/interactive/scene-text'
import './scene-text-editor.css'

export type SceneTextEditorProps = {
  value: string
  readOnly?: boolean
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  hint?: string
  max?: number
  className?: string
  testId?: string
}

/**
 * The scene's primary writing surface. It deliberately contains only text:
 * pictures and generation belong to the production layer, not to the script.
 */
export function SceneTextEditor({
  value,
  readOnly = false,
  onChange,
  label = '剧情文字',
  placeholder = '写下这一段的动作、台词或旁白…',
  hint = '换行会保留。片段画面在制作层补充，不影响文字。',
  max = SCENE_TEXT_MAX,
  className,
  testId,
}: SceneTextEditorProps) {
  const id = useId()
  const metrics = sceneTextMetrics(value, max)
  const rows = fitSceneTextRows(metrics.text)
  const nearLimit = metrics.remaining <= Math.max(20, Math.floor(metrics.max * 0.05))
  const countClass = metrics.isFull ? ' is-full' : nearLimit ? ' is-near' : ''

  return (
    <div className={`nori-scene-text${readOnly ? ' is-readonly' : ''}${className ? ` ${className}` : ''}`} data-testid={testId}>
      <div className="nori-scene-text-head">
        <label htmlFor={id}>{label}</label>
        <span className={`nori-scene-text-count${countClass}`} aria-live="polite">
          {metrics.chars} / {metrics.max}
        </span>
      </div>
      <textarea
        id={id}
        className="nodrag nowheel nori-scene-text-area"
        value={value}
        rows={rows}
        placeholder={placeholder}
        readOnly={readOnly}
        maxLength={max}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Keep canvas shortcuts (delete/undo/space pan) away from the script.
          if (event.key === 'Escape') {
            event.stopPropagation()
            event.currentTarget.blur()
            return
          }
          if (event.key === 'Delete' || event.key === 'Backspace' || event.key === ' ') {
            event.stopPropagation()
          }
        }}
      />
      <p className="nori-scene-text-hint" id={`${id}-hint`}>{hint}</p>
    </div>
  )
}
