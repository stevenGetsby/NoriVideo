'use client'

import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ScriptStatus, WriterEpisode, WriterScript } from './screenwriterModels'
import { SCRIPT_STATUS_LABELS } from './screenwriterModels'

interface FosWriterWorkspaceProps {
  scripts: WriterScript[]
  setScripts: Dispatch<SetStateAction<WriterScript[]>>
  activeId: string
  setActiveId: (id: string) => void
  status: ScriptStatus
  setStatus: (status: ScriptStatus) => void
  onNotice: (message: string) => void
  loading?: boolean
  onScriptChange?: (script: WriterScript) => void
  onDeleteScript?: (scriptId: string) => void
}

export function FosWriterWorkspace(props: FosWriterWorkspaceProps) {
  const { scripts, setScripts, activeId, setActiveId, status, setStatus, onNotice, loading, onScriptChange, onDeleteScript } = props
  const [asideCollapsed, setAsideCollapsed] = useState(false)
  const [activeEpisodeId, setActiveEpisodeId] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const filtered = useMemo(() => scripts.filter((script) => script.status === status), [scripts, status])
  const activeScript = scripts.find((script) => script.id === activeId)
  const activeEpisode = activeScript?.episodes.find((episode) => episode.id === activeEpisodeId)
    ?? activeScript?.episodes[0]

  const chooseStatus = (next: ScriptStatus) => {
    setStatus(next)
    const first = scripts.find((script) => script.status === next)
    setActiveId(first?.id ?? '')
    setActiveEpisodeId(first?.episodes[0]?.id ?? '')
  }

  const chooseScript = (script: WriterScript) => {
    setActiveId(script.id)
    setActiveEpisodeId(script.episodes[0]?.id ?? '')
  }

  const updateScript = (updater: (script: WriterScript) => WriterScript) => {
    if (!activeScript) return
    const nextScript = updater(activeScript)
    setScripts((current) => current.map((script) => script.id === activeScript.id ? nextScript : script))
    onScriptChange?.(nextScript)
  }

  const updateEpisode = (updater: (episode: WriterEpisode) => WriterEpisode) => {
    if (!activeEpisode) return
    updateScript((script) => ({
      ...script,
      updatedAt: '刚刚',
      episodes: script.episodes.map((episode) => episode.id === activeEpisode.id ? updater(episode) : episode),
    }))
  }

  const moveTo = (nextStatus: ScriptStatus) => {
    if (!activeScript) return
    updateScript((script) => ({ ...script, status: nextStatus, updatedAt: '刚刚' }))
    setStatus(nextStatus)
    onNotice(nextStatus === 'available' ? '剧本已标记为可用' : nextStatus === 'draft' ? '剧本已回退至草稿' : '剧本已归档')
  }

  const exportScript = () => {
    if (!activeScript) return
    const content = activeScript.episodes.map((episode, index) => `第 ${index + 1} 集  ${episode.title}\n\n${episode.body}`).join('\n\n--------------------\n\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activeScript.title || '未命名剧本'}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
    onNotice('剧本已导出为 TXT 文件')
  }

  const deleteScript = () => {
    if (!activeScript) return
    setScripts((current) => current.filter((script) => script.id !== activeScript.id))
    const next = filtered.find((script) => script.id !== activeScript.id)
    setActiveId(next?.id ?? '')
    setActiveEpisodeId(next?.episodes[0]?.id ?? '')
    setMoreOpen(false)
    void onDeleteScript?.(activeScript.id)
    onNotice('剧本已删除')
  }

  const addEpisode = () => {
    if (!activeScript) return
    const number = activeScript.episodes.length + 1
    const id = `${activeScript.id}-ep-${Date.now()}`
    updateScript((script) => ({
      ...script,
      updatedAt: '刚刚',
      episodes: [...script.episodes, { id, title: `第 ${number} 集`, body: '' }],
    }))
    setActiveEpisodeId(id)
  }

  const deleteEpisode = (episodeId: string) => {
    if (!activeScript || activeScript.episodes.length <= 1) {
      onNotice('剧本至少需要保留 1 集')
      return
    }
    const nextEpisodes = activeScript.episodes.filter((episode) => episode.id !== episodeId)
    updateScript((script) => ({ ...script, updatedAt: '刚刚', episodes: nextEpisodes }))
    setActiveEpisodeId(nextEpisodes[0]?.id ?? '')
  }

  return (
    <div className="writer-workbench">
      <aside className={`writer-aside${asideCollapsed ? ' writer-aside--collapsed' : ''}`}>
        {asideCollapsed ? (
          <button type="button" className="aside-expand-btn" title="展开列表" onClick={() => setAsideCollapsed(false)}>
            <AppIcon name="chevronRight" className="h-4 w-4" />
          </button>
        ) : (
          <>
            <div className="aside-head">
              <strong className="aside-brand">我的剧本</strong>
              <button type="button" className="aside-collapse-btn" title="收起侧栏" onClick={() => setAsideCollapsed(true)}>
                <AppIcon name="chevronLeft" className="h-4 w-4" />
              </button>
            </div>
            <div className="aside-tabs" role="tablist" aria-label="剧本状态">
              {(Object.keys(SCRIPT_STATUS_LABELS) as ScriptStatus[]).map((item) => {
                const count = scripts.filter((script) => script.status === item).length
                return (
                  <button key={item} type="button" role="tab" aria-selected={status === item} className={status === item ? 'active' : ''} onClick={() => chooseStatus(item)}>
                    {SCRIPT_STATUS_LABELS[item]} <span>{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="aside-list">
              <div className="aside-rows">
                {filtered.map((script) => (
                  <button key={script.id} type="button" className={`list-row${script.id === activeId ? ' active' : ''}`} onClick={() => chooseScript(script)}>
                    <span className="list-title-row">
                      <span className="list-title">{script.title}</span>
                      <span className="list-title-count">{script.episodes.length} 集</span>
                    </span>
                    <span className="list-meta">
                      <span className="list-type">{script.type}</span>
                      <span className="list-time">{script.updatedAt}</span>
                    </span>
                  </button>
                ))}
                {!filtered.length ? <div className="aside-empty">暂无{SCRIPT_STATUS_LABELS[status]}剧本</div> : null}
                {filtered.length ? <div className="aside-foot"><span className="aside-foot-line" /><span className="aside-foot-text">已加载全部</span><span className="aside-foot-line" /></div> : null}
              </div>
            </div>
          </>
        )}
      </aside>

      <section className="writer-main">
        {activeScript ? (
          <>
            <header className="writer-detail-header">
              <div className="writer-detail-header-main">
                <div className="writer-detail-title-row">
                  <input
                    className="writer-detail-title-input"
                    value={activeScript.title}
                    maxLength={200}
                    aria-label="剧本标题"
                    onChange={(event) => updateScript((script) => ({ ...script, title: event.target.value, updatedAt: '刚刚' }))}
                  />
                  <span className={`writer-status-badge writer-status-badge--${activeScript.status}`}>{SCRIPT_STATUS_LABELS[activeScript.status]}</span>
                </div>
                <p className="writer-detail-meta">
                  {activeScript.type}
                  {activeScript.lineage ? <><span className="meta-dot">·</span>转绘自 <span className="writer-detail-meta-lineage">{activeScript.lineage}</span></> : null}
                  <span className="meta-dot">·</span>创建于 {activeScript.createdAt}
                  <span className="meta-dot">·</span>最后更新 {activeScript.updatedAt}
                </p>
              </div>
              <div className="writer-detail-header-actions">
                {activeScript.status === 'draft' ? <button type="button" className="wdh-btn wdh-btn--primary" onClick={() => moveTo('available')}>标记为可用</button> : null}
                {activeScript.status === 'available' ? <button type="button" className="wdh-btn" onClick={() => moveTo('draft')}>回退至草稿</button> : null}
                <button type="button" className="wdh-btn" onClick={exportScript}><AppIcon name="download" className="h-3.5 w-3.5" />导出</button>
                <div className="writer-more-wrap">
                  <button type="button" className="wdh-btn wdh-btn--icon" aria-label="更多" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><AppIcon name="menu" className="h-4 w-4" /></button>
                  {moreOpen ? (
                    <div className="fos-menu writer-more-menu">
                      {activeScript.status === 'archived'
                        ? <button type="button" className="fos-menu-item" onClick={() => moveTo('draft')}><AppIcon name="undo" className="h-3.5 w-3.5" />取消归档</button>
                        : <button type="button" className="fos-menu-item" onClick={() => moveTo('archived')}><AppIcon name="package" className="h-3.5 w-3.5" />归档</button>}
                      <button type="button" className="fos-menu-item writer-delete-item" onClick={deleteScript}><AppIcon name="trash" className="h-3.5 w-3.5" />删除剧本</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>

            <div className="writer-detail-frame">
              <nav className="writer-rail" aria-label="分集导航">
                <div className="writer-rail-scroll">
                  <div className="writer-rail-inner">
                    {activeScript.episodes.map((episode, index) => (
                      <div key={episode.id} className="rail-item-wrap">
                        <button type="button" className={`rail-item${episode.id === activeEpisode?.id ? ' active' : ''}`} onClick={() => setActiveEpisodeId(episode.id)}>
                          <span className="rail-ep-num">E{String(index + 1).padStart(2, '0')}</span>
                          <span className="rail-ep-title">{episode.title || '未命名分集'}</span>
                        </button>
                        <div className="rail-item-actions">
                          <button type="button" className="rail-action-btn rail-action-btn--danger" title="删除分集" onClick={() => deleteEpisode(episode.id)}><AppIcon name="trash" className="h-3 w-3" /></button>
                        </div>
                      </div>
                    ))}
                    <button type="button" className="rail-item rail-item--add" onClick={addEpisode}><AppIcon name="plus" className="h-3.5 w-3.5" />添加分集</button>
                  </div>
                </div>
              </nav>

              {activeEpisode ? (
                <article className="writer-pane">
                  <div className="writer-pane-toolbar">
                    <div className="writer-pane-ep-head">
                      <span className="writer-pane-ep-num">E{String(activeScript.episodes.findIndex((episode) => episode.id === activeEpisode.id) + 1).padStart(2, '0')}</span>
                      <input className="writer-pane-episode-title" value={activeEpisode.title} maxLength={100} aria-label="分集标题" onChange={(event) => updateEpisode((episode) => ({ ...episode, title: event.target.value }))} />
                    </div>
                    <span className="writer-pane-wordcount">{[...activeEpisode.body].length} 字</span>
                  </div>
                  <textarea
                    className="body-textarea"
                    value={activeEpisode.body}
                    placeholder="在这里编写本集剧本……"
                    spellCheck={false}
                    onChange={(event) => updateEpisode((episode) => ({ ...episode, body: event.target.value }))}
                  />
                </article>
              ) : <div className="writer-detail-empty-pane"><strong>暂无分集</strong><span>添加分集后即可开始编辑</span></div>}
            </div>
          </>
        ) : (
          <div className="writer-main-empty">
            <div className="empty-state">
              <AppIcon name="fileText" className="empty-state-icon" />
              <h2>{loading ? '正在读取当前账号剧本…' : '当前账号还没有剧本'}</h2>
              <p>{loading ? '请稍候' : '从上方“视频转绘”上传一集视频，即可生成第一份稿件。'}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
