'use client'

import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { FosWriterWorkspace } from './FosWriterWorkspace'
import type { ScriptStatus, WriterScript } from './screenwriterModels'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readApiMessage(value: unknown): string {
  if (!isRecord(value)) return ''
  const error = isRecord(value.error) ? value.error : null
  return typeof error?.message === 'string'
    ? error.message
    : typeof value.message === 'string' ? value.message : ''
}

function displayTime(value: string, relative = false): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const distance = Date.now() - date.getTime()
  if (relative && distance >= 0 && distance < 60_000) return '刚刚'
  if (relative && distance >= 0 && distance < 60 * 60_000) return `${Math.max(1, Math.floor(distance / 60_000))} 分钟前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function presentScript(script: WriterScript): WriterScript {
  return {
    ...script,
    createdAt: displayTime(script.createdAt),
    updatedAt: displayTime(script.updatedAt, true),
  }
}

export function FosScreenwriter() {
  const [scripts, setScripts] = useState<WriterScript[]>([])
  const [activeId, setActiveId] = useState('')
  const [status, setStatus] = useState<ScriptStatus>('draft')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const saveTimers = useRef(new Map<string, number>())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/video-repaint/scripts', { cache: 'no-store' })
        const payload: unknown = await response.json().catch(() => ({}))
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.scripts)) {
          throw new Error(readApiMessage(payload) || '剧本读取失败')
        }
        const nextScripts = payload.scripts.filter(isRecord) as unknown as WriterScript[]
        if (cancelled) return
        const presented = nextScripts.map(presentScript)
        setScripts(presented)
        const firstDraft = presented.find((script) => script.status === 'draft')
        const first = firstDraft || presented[0]
        setStatus(first?.status || 'draft')
        setActiveId(first?.id || '')
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : '剧本读取失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      saveTimers.current.forEach((timer) => window.clearTimeout(timer))
      saveTimers.current.clear()
    }
  }, [])

  const persistScript = (script: WriterScript) => {
    const currentTimer = saveTimers.current.get(script.id)
    if (currentTimer) window.clearTimeout(currentTimer)
    const timer = window.setTimeout(async () => {
      saveTimers.current.delete(script.id)
      try {
        const response = await fetch(`/api/video-repaint/scripts/${encodeURIComponent(script.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: script.title, status: script.status, episodes: script.episodes }),
        })
        const payload: unknown = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(readApiMessage(payload) || '剧本保存失败')
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '剧本保存失败')
      }
    }, 650)
    saveTimers.current.set(script.id, timer)
  }

  const deleteScript = async (scriptId: string) => {
    const currentTimer = saveTimers.current.get(scriptId)
    if (currentTimer) window.clearTimeout(currentTimer)
    saveTimers.current.delete(scriptId)
    try {
      const response = await fetch(`/api/video-repaint/scripts/${encodeURIComponent(scriptId)}`, { method: 'DELETE' })
      const payload: unknown = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(readApiMessage(payload) || '剧本删除失败')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '剧本删除失败')
    }
  }

  return (
    <div className="writer-page">
      <header className="writer-page-header">
        <h1>编剧工作台</h1>
        <button type="button" className="writer-permission-btn" onClick={() => setNotice('剧本只归属于当前登录账号，不会显示其他账号的草稿。')}>
          <AppIcon name="badgeCheck" className="h-3.5 w-3.5" />创作权限
        </button>
        <span className="writer-page-hint">账号私有空间</span>
      </header>

      <section className="writer-create-strip" aria-label="创建剧本">
        <div className="wc-group wc-group--primary">
          <div className="wc-group-description">
            <AppIcon name="info" className="h-4 w-4" />
            <span>视频转绘已停用，已有剧本仍可继续编辑。</span>
          </div>
        </div>
      </section>

      <div className="writer-page-body">
        <FosWriterWorkspace
          scripts={scripts}
          setScripts={setScripts}
          activeId={activeId}
          setActiveId={setActiveId}
          status={status}
          setStatus={setStatus}
          onNotice={setNotice}
          loading={loading}
          onScriptChange={persistScript}
          onDeleteScript={deleteScript}
        />
      </div>

      {notice ? (
        <div className="writer-toast" role="status">
          <AppIcon name="check" className="h-4 w-4" />
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><AppIcon name="close" className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}

    </div>
  )
}
