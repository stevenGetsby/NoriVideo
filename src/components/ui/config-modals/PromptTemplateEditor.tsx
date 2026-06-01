'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface PromptMeta {
  promptId: string
  variableKeys: string[]
  hasOverride: { zh: boolean; en: boolean }
}

// 用户可能关心的核心步骤（按流程顺序分组）
const PROMPT_GROUPS = [
  {
    label: '剧本拆分',
    items: [
      { id: 'np_agent_clip', label: '片段拆分' },
      { id: 'np_screenplay_conversion', label: '剧本格式转换' },
      { id: 'np_episode_split', label: '长文本分集' },
    ],
  },
  {
    label: '角色/资产分析',
    items: [
      { id: 'np_agent_character_profile', label: '角色档案分析' },
      { id: 'np_agent_character_visual', label: '角色外观描述' },
      { id: 'np_character_create', label: 'AI 创建角色' },
      { id: 'np_location_create', label: 'AI 创建场景' },
    ],
  },
  {
    label: '分镜生成',
    items: [
      { id: 'np_agent_storyboard_plan', label: '分镜规划' },
      { id: 'np_agent_storyboard_detail', label: '分镜细化' },
      { id: 'np_agent_cinematographer', label: '镜头设计' },
      { id: 'np_agent_acting_direction', label: '演技指导' },
      { id: 'np_single_panel_image', label: '单帧图片生成' },
    ],
  },
  {
    label: '台词/配音',
    items: [
      { id: 'np_voice_analysis', label: '台词分析' },
    ],
  },
  {
    label: '编辑/修改',
    items: [
      { id: 'np_image_prompt_modify', label: '图片提示词修改' },
      { id: 'np_storyboard_edit', label: '分镜编辑' },
      { id: 'np_character_description_update', label: '角色描述修改' },
      { id: 'np_location_description_update', label: '场景描述修改' },
    ],
  },
]

export function PromptTemplateEditor({ onClose }: { onClose: () => void }) {
  const [prompts, setPrompts] = useState<PromptMeta[]>([])
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [defaultTemplate, setDefaultTemplate] = useState('')
  const [userTemplate, setUserTemplate] = useState('')
  const [variableKeys, setVariableKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const locale = 'zh'

  // 加载 prompt 列表
  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch('/api/prompt-templates')
        if (res.ok) {
          const data = await res.json()
          setPrompts(data.prompts || [])
        }
      } catch {
        // silent
      }
    }
    void load()
  }, [])

  // 加载单个 prompt 详情
  const loadPromptDetail = useCallback(async (promptId: string) => {
    setLoading(true)
    setSelectedPromptId(promptId)
    try {
      const res = await apiFetch(`/api/prompt-templates?promptId=${promptId}&locale=${locale}`)
      if (res.ok) {
        const data = await res.json()
        setDefaultTemplate(data.defaultTemplate || '')
        setUserTemplate(data.userTemplate || '')
        setVariableKeys(data.variableKeys || [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [locale])

  // 保存自定义模板
  const handleSave = useCallback(async () => {
    if (!selectedPromptId) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/prompt-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptId: selectedPromptId,
          locale,
          template: userTemplate.trim() || null,
        }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        // 更新列表状态
        setPrompts(prev => prev.map(p =>
          p.promptId === selectedPromptId
            ? { ...p, hasOverride: { ...p.hasOverride, [locale]: !!userTemplate.trim() } }
            : p
        ))
      }
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }, [selectedPromptId, userTemplate, locale])

  // 恢复默认
  const handleReset = useCallback(() => {
    setUserTemplate('')
  }, [])

  // 复制默认模板到编辑区
  const handleCopyDefault = useCallback(() => {
    setUserTemplate(defaultTemplate)
  }, [defaultTemplate])

  const hasOverride = (promptId: string) => {
    const meta = prompts.find(p => p.promptId === promptId)
    return meta?.hasOverride?.zh || meta?.hasOverride?.en
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="glass-surface-modal w-full max-w-5xl max-h-[85vh] flex flex-col rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--glass-stroke-base)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">自定义提示词模板</h2>
            <p className="text-xs text-[var(--glass-text-tertiary)] mt-0.5">自定义各步骤的 AI 系统提示词，覆盖默认模板。留空则使用系统默认。</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-surface-hover)]"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: prompt list */}
          <div className="w-64 flex-shrink-0 border-r border-[var(--glass-stroke-base)] overflow-y-auto app-scrollbar p-3">
            {PROMPT_GROUPS.map((group) => (
              <div key={group.label} className="mb-4">
                <div className="text-[10px] font-bold text-[var(--glass-text-tertiary)] uppercase tracking-wider mb-1.5 px-2">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const isSelected = selectedPromptId === item.id
                  const isCustomized = hasOverride(item.id)
                  return (
                    <button
                      key={item.id}
                      onClick={() => { void loadPromptDetail(item.id) }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors mb-0.5 flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] font-medium'
                          : 'text-[var(--glass-text-secondary)] hover:bg-[var(--glass-surface-hover)]'
                      }`}
                    >
                      {isCustomized && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--glass-tone-info-fg)] flex-shrink-0" />
                      )}
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Right: editor */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {selectedPromptId ? (
              <>
                <div className="p-4 border-b border-[var(--glass-stroke-base)] flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[var(--glass-text-primary)]">
                      {PROMPT_GROUPS.flatMap(g => g.items).find(i => i.id === selectedPromptId)?.label}
                    </span>
                    {variableKeys.length > 0 && (
                      <span className="text-[10px] text-[var(--glass-text-tertiary)]">
                        变量: {variableKeys.map(k => `{${k}}`).join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyDefault}
                      className="text-xs text-[var(--glass-text-secondary)] hover:text-[var(--glass-tone-info-fg)] transition-colors"
                    >
                      复制默认模板
                    </button>
                    <button
                      onClick={handleReset}
                      className="text-xs text-[var(--glass-text-secondary)] hover:text-[var(--glass-tone-danger-fg)] transition-colors"
                    >
                      恢复默认
                    </button>
                    <button
                      onClick={() => { void handleSave() }}
                      disabled={saving}
                      className="glass-btn-base glass-btn-primary px-3 py-1 text-xs rounded-lg disabled:opacity-50"
                    >
                      {saving ? '保存中...' : saved ? '已保存 ✓' : '保存'}
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex gap-0 min-h-0 overflow-hidden">
                  {/* Default template (read-only) */}
                  <div className="flex-1 flex flex-col border-r border-[var(--glass-stroke-base)] min-w-0">
                    <div className="px-3 py-2 text-[10px] font-medium text-[var(--glass-text-tertiary)] bg-[var(--glass-bg-muted)] flex-shrink-0">
                      默认模板（只读）
                    </div>
                    <textarea
                      value={loading ? '加载中...' : defaultTemplate}
                      readOnly
                      className="flex-1 w-full p-3 text-xs font-mono bg-transparent text-[var(--glass-text-secondary)] resize-none outline-none app-scrollbar"
                    />
                  </div>

                  {/* User template (editable) */}
                  <div className="flex-1 flex flex-col min-w-0">
                    <div className="px-3 py-2 text-[10px] font-medium text-[var(--glass-text-tertiary)] bg-[var(--glass-bg-muted)] flex-shrink-0">
                      自定义模板（留空使用默认）
                    </div>
                    <textarea
                      value={userTemplate}
                      onChange={(e) => setUserTemplate(e.target.value)}
                      placeholder="在此输入自定义模板...&#10;&#10;使用 {变量名} 引用动态内容，可用变量见上方提示。"
                      className="flex-1 w-full p-3 text-xs font-mono bg-transparent text-[var(--glass-text-primary)] resize-none outline-none app-scrollbar placeholder:text-[var(--glass-text-tertiary)]"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--glass-text-tertiary)]">
                <div className="text-center">
                  <AppIcon name="fileText" className="w-10 h-10 mx-auto mb-3" />
                  <p className="text-sm">选择左侧的提示词步骤进行编辑</p>
                  <p className="text-xs mt-1">自定义模板将覆盖系统默认模板</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
