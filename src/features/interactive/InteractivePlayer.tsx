'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, X } from '@/components/ui/icons'
import { STORY_KIND_LABEL } from '@/lib/interactive/compile'
import { advanceRun, initialVariables, startRun, type StoryRun } from '@/lib/interactive/engine'
import type { StoryAspectRatio, StoryMedia, StoryProgram, StoryVariables } from '@/lib/interactive/types'
import { PlayerStage } from './PlayerStage'
import './interactive.css'

export type InteractivePlayerProps = {
  program: StoryProgram
  mode: 'story' | 'chapter'
  aspectRatio: StoryAspectRatio
  title: string
  projectId?: string
  entryNodeId?: string | null
  onClose: () => void
  onLocate?: (projectId: string, nodeId: string) => void
}

function lastSceneMedia(program: StoryProgram, run: StoryRun): StoryMedia | null {
  for (let index = run.trail.length - 1; index >= 0; index -= 1) {
    const step = run.trail[index]
    if (step.kind !== 'scene') continue
    const node = program.chapters.find((chapter) => chapter.projectId === step.projectId)?.nodes.find((item) => item.id === step.nodeId)
    if (node?.kind === 'scene' && node.media) return node.media
  }
  return null
}

export function InteractivePlayer({ program, mode, aspectRatio, title, projectId, entryNodeId, onClose, onLocate }: InteractivePlayerProps) {
  const entries = useMemo(() => (mode === 'chapter'
    ? program.chapters.find((chapter) => chapter.projectId === projectId)?.nodes.filter((node) => node.kind === 'entry') ?? []
    : []), [mode, program, projectId])
  const [entryId, setEntryId] = useState<string | null>(entryNodeId ?? entries[0]?.id ?? null)
  const [preset, setPreset] = useState<StoryVariables>(() => initialVariables(program.variables))
  const begin = useCallback((nextEntry = entryId, nextPreset = preset) => startRun(program, {
    mode,
    projectId,
    entryNodeId: mode === 'chapter' ? nextEntry ?? undefined : entryNodeId ?? undefined,
    preset: nextPreset,
  }), [entryId, entryNodeId, mode, preset, program, projectId])
  const [run, setRun] = useState<StoryRun>(() => begin())
  const backdrop = useMemo(() => lastSceneMedia(program, run), [program, run])
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape'
  const stepKey = `${run.trail.length}:${run.trail[run.trail.length - 1]?.nodeId ?? ''}`

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const restart = () => setRun(begin())

  return createPortal(
    <div className="nori-player" role="dialog" aria-modal="true" aria-label={`试玩：${title}`}
      onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      <header className="nori-player-head">
        <div>
          <span className="nori-player-mode">{mode === 'story' ? '全剧试玩' : '单章试玩'}</span>
          <strong>{title}</strong>
          <span className="nori-player-format">{aspectRatio === '9:16' ? '竖屏 9:16' : '横屏 16:9'}</span>
        </div>
        <div>
          <button type="button" onClick={restart}><RotateCcw />重新开始</button>
          <button type="button" className="is-icon" aria-label="关闭试玩" onClick={onClose}><X /></button>
        </div>
      </header>
      <div className="nori-player-body">
        <div className="nori-player-stage-wrap">
          <div className={`nori-player-stage is-${orientation}`}>
            <PlayerStage
              stop={run.stop}
              stepKey={stepKey}
              backdrop={backdrop}
              orientation={orientation}
              onContinue={() => setRun((current) => advanceRun(program, current))}
              onChoose={(optionId) => setRun((current) => advanceRun(program, current, optionId))}
              onRestart={restart}
              onLocate={onLocate ? (chapterId, nodeId) => { onClose(); onLocate(chapterId, nodeId) } : undefined}
            />
          </div>
        </div>
        <aside className="nori-player-side">
          {mode === 'chapter' && entries.length > 1 ? (
            <section>
              <h3>入口</h3>
              <select value={entryId ?? ''} onChange={(event) => { setEntryId(event.target.value); setRun(begin(event.target.value)) }}>
                {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
              </select>
            </section>
          ) : null}
          <section>
            <h3>全局变量</h3>
            {program.variables.length === 0 ? <p className="nori-player-empty">没有全局变量</p> : (
              <table className="nori-player-vars">
                <thead><tr><th>变量</th><th>当前</th><th>起始</th></tr></thead>
                <tbody>
                  {program.variables.map((variable) => {
                    const value = run.vars[variable.id]
                    const changed = value !== preset[variable.id]
                    return (
                      <tr key={variable.id} className={changed ? 'is-changed' : ''}>
                        <td>{variable.name}</td>
                        <td>{variable.type === 'boolean' ? (value ? '是' : '否') : String(value)}</td>
                        <td>
                          {variable.type === 'boolean'
                            ? <input type="checkbox" checked={preset[variable.id] === true} onChange={(event) => setPreset({ ...preset, [variable.id]: event.target.checked })} />
                            : <input type="number" value={Number(preset[variable.id] ?? 0)} onChange={(event) => setPreset({ ...preset, [variable.id]: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0 })} />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {program.variables.length ? <button type="button" className="nori-player-side-action" onClick={restart}>用起始值重新开始</button> : null}
          </section>
          <section className="is-trail">
            <h3>路径</h3>
            <ol>
              {run.trail.map((step, index) => (
                <li key={`${index}:${step.nodeId}`}>
                  <span>{STORY_KIND_LABEL[step.kind]}</span>
                  <strong>{step.title}</strong>
                  {step.choice ? <em>→ {step.choice}</em> : null}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>,
    document.body,
  )
}
