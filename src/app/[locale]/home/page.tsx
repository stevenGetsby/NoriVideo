'use client'

/**
 * 首页 - 创作中心
 * 用户登录后的主入口页面：快速创作 + 最近项目
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import { AppIcon, IconGradientDefs } from '@/components/ui/icons'
import StoryInputComposer from '@/components/story-input/StoryInputComposer'
import TypewriterHero from '@/components/home/TypewriterHero'
import { ART_STYLES, VIDEO_RATIOS, resolveCustomArtStylePrompt } from '@/lib/constants'
import { DEFAULT_STYLE_PRESET_VALUE, STYLE_PRESETS } from '@/lib/style-presets'
import { Link, useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { expandHomeStory } from '@/lib/home/ai-story-expand'
import { createHomeProjectLaunch } from '@/lib/home/create-project-launch'
import { formatDefaultProjectTimestamp } from '@/lib/projects/default-name'
import { HOME_QUICK_START_MIN_ROWS } from '@/lib/ui/textarea-height'
import AiWriteModal from '@/components/home/AiWriteModal'
import { useCustomArtStyles } from '@/lib/query/hooks/useCustomArtStyles'
import { CustomArtStyleModal } from '@/components/selectors/CustomArtStyleModal'

interface ProjectStats {
  episodes: number
  images: number
  videos: number
  panels: number
  firstEpisodePreview: string | null
}

interface Project {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  stats?: ProjectStats
}

const RECENT_COUNT = 5
const TEST_MODE_ENABLED = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'

export default function HomePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const t = useTranslations('home')
  const tc = useTranslations('common')

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [inputValue, setInputValue] = useState('')
  const [videoRatio, setVideoRatio] = useState('9:16')
  const [artStyle, setArtStyle] = useState('american-comic')
  const [stylePresetValue, setStylePresetValue] = useState<string>(DEFAULT_STYLE_PRESET_VALUE)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [aiWriteOpen, setAiWriteOpen] = useState(false)
  const [aiWriteLoading, setAiWriteLoading] = useState(false)
  const [customStyleModalOpen, setCustomStyleModalOpen] = useState(false)
  const [editingCustomStyleId, setEditingCustomStyleId] = useState<string | null>(null)

  const { customStyles, addStyle, updateStyle, deleteStyle } = useCustomArtStyles()

  // 鉴权
  useEffect(() => {
    if (status === 'loading') return
    if (!session && !TEST_MODE_ENABLED) {
      router.push({ pathname: '/auth/signin' })
    }
  }, [session, status, router])

  // 获取最近项目
  const fetchRecentProjects = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: '1',
        pageSize: RECENT_COUNT.toString(),
      })
      const response = await apiFetch(`/api/projects?${params}`)
      if (response.ok) {
        const data = await response.json()
        setProjects(data.projects)
      }
    } catch {
      // 静默处理
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session || TEST_MODE_ENABLED) {
      void fetchRecentProjects()
    }
  }, [session, fetchRecentProjects])

  // 创建项目并跳转
  const handleCreate = async () => {
    if (!inputValue.trim() || createLoading) return
    setCreateError(null)
    setCreateLoading(true)
    try {
      const storyText = inputValue.trim()
      const artStylePrompt = artStyle.startsWith('custom:')
        ? resolveCustomArtStylePrompt(artStyle, 'zh', customStyles)
        : undefined
      const result = await createHomeProjectLaunch({
        apiFetch,
        projectName: t('defaultProjectName', {
          timestamp: formatDefaultProjectTimestamp(new Date()),
        }),
        storyText,
        videoRatio,
        artStyle,
        artStylePrompt,
        episodeName: `${tc('episode')} 1`,
      })

      window.sessionStorage.setItem(`nori:home-draft:${result.projectId}`, storyText)
      router.push(result.target)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('createFailed')
      setCreateError(message)
    } finally {
      setCreateLoading(false)
    }
  }

  // AI 帮我写 — 直接生成文本并回填首页输入框
  const handleAiWriteStart = async (prompt: string) => {
    if (aiWriteLoading) return
    setAiWriteLoading(true)
    try {
      const result = await expandHomeStory({
        apiFetch,
        prompt,
      })

      setInputValue(result.expandedText)
      setAiWriteOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed'
      window.alert(message)
    } finally {
      setAiWriteLoading(false)
    }
  }

  // 比例选项（带推荐标签）
  const ratioOptions = useMemo(
    () => VIDEO_RATIOS.map((r) => ({ ...r, recommended: r.value === '9:16' })),
    []
  )

  // 风格选项（带推荐标签）
  const styleOptions = useMemo(
    () => ART_STYLES.map((s) => ({ ...s, recommended: s.value === 'realistic' })),
    []
  )

  const customStyleOptions = useMemo(
    () => customStyles.map((s) => ({ value: `custom:${s.id}`, label: s.label })),
    [customStyles]
  )

  const editingCustomStyle = useMemo(
    () => editingCustomStyleId ? customStyles.find((s) => s.id === editingCustomStyleId) ?? null : null,
    [editingCustomStyleId, customStyles]
  )

  const handleAddCustomStyle = useCallback(() => {
    setEditingCustomStyleId(null)
    setCustomStyleModalOpen(true)
  }, [])

  const handleEditCustomStyle = useCallback((value: string) => {
    const id = value.startsWith('custom:') ? value.slice(7) : value
    setEditingCustomStyleId(id)
    setCustomStyleModalOpen(true)
  }, [])

  const handleDeleteCustomStyle = useCallback(async (value: string) => {
    const id = value.startsWith('custom:') ? value.slice(7) : value
    await deleteStyle(id)
    if (artStyle === value) {
      setArtStyle('american-comic')
    }
  }, [artStyle, deleteStyle])

  const handleSaveCustomStyle = useCallback(async (data: { label: string; promptZh: string; promptEn: string }) => {
    if (editingCustomStyleId) {
      await updateStyle(editingCustomStyleId, data)
    } else {
      const newStyle = await addStyle(data)
      setArtStyle(`custom:${newStyle.id}`)
    }
    setCustomStyleModalOpen(false)
    setEditingCustomStyleId(null)
  }, [editingCustomStyleId, updateStyle, addStyle])

  // 时间格式化
  const formatTimeAgo = (dateString: string): string => {
    const diffMs = Date.now() - new Date(dateString).getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffMinutes < 1) return t('ago.justNow')
    if (diffMinutes < 60) return t('ago.minutesAgo', { n: diffMinutes })
    if (diffHours < 24) return t('ago.hoursAgo', { n: diffHours })
    return t('ago.daysAgo', { n: diffDays })
  }

  if (status === 'loading' || (!session && !TEST_MODE_ENABLED)) {
    return (
      <div className="glass-page min-h-screen flex items-center justify-center">
        <div className="text-[var(--glass-text-secondary)]">{tc('loading')}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#ECF1F4] text-[#0e0e2c]">
      <Navbar />
      {TEST_MODE_ENABLED && (
        <div className="fixed left-4 top-20 z-50 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
          Test mode
        </div>
      )}

      {/* 自定义呼吸动画 */}
      <style>{`
        @keyframes breathe-drift-1 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
          25% { transform: translate(30px, -20px) scale(1.15); opacity: 0.7; }
          50% { transform: translate(-20px, 15px) scale(0.95); opacity: 0.4; }
          75% { transform: translate(15px, 25px) scale(1.1); opacity: 0.65; }
        }
        @keyframes breathe-drift-2 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.45; }
          30% { transform: translate(-25px, 20px) scale(1.2); opacity: 0.7; }
          60% { transform: translate(20px, -15px) scale(0.9); opacity: 0.35; }
          80% { transform: translate(-10px, -25px) scale(1.05); opacity: 0.6; }
        }
        @keyframes breathe-drift-3 {
          0%, 100% { transform: translate(0, 0) scale(1.05); opacity: 0.4; }
          20% { transform: translate(20px, 15px) scale(0.9); opacity: 0.55; }
          45% { transform: translate(-15px, -20px) scale(1.15); opacity: 0.7; }
          70% { transform: translate(10px, -10px) scale(1); opacity: 0.35; }
        }
        @keyframes bracket-breathe {
          0%, 70%, 100% { opacity: 0.2; }
          75%, 90% { opacity: 0.6; }
        }
      `}</style>

      <main className="flex flex-col items-center pt-[11vh] pb-12 px-4 max-w-5xl mx-auto w-full">

        {/* ─── 取景器整体包裹：标题 + 输入框 ─── */}
        <div className="w-full relative rounded-[28px] border border-[rgba(14,14,44,.08)] bg-[#fafcfe]/85 p-5 shadow-[0_22px_54px_rgba(14,14,44,.095),0_4px_12px_rgba(14,14,44,.055)] backdrop-blur-xl">
          {/* 四角校准线 */}
          <span className="absolute top-0 left-0 w-5 h-5 border-t border-l border-[var(--glass-text-primary)] pointer-events-none z-10" style={{ animation: 'bracket-breathe 8s ease-in-out infinite' }} />
          <span className="absolute top-0 right-0 w-5 h-5 border-t border-r border-[var(--glass-text-primary)] pointer-events-none z-10" style={{ animation: 'bracket-breathe 8s ease-in-out infinite' }} />
          <span className="absolute bottom-0 left-0 w-5 h-5 border-b border-l border-[var(--glass-text-primary)] pointer-events-none z-10" style={{ animation: 'bracket-breathe 8s ease-in-out infinite' }} />
          <span className="absolute bottom-0 right-0 w-5 h-5 border-b border-r border-[var(--glass-text-primary)] pointer-events-none z-10" style={{ animation: 'bracket-breathe 8s ease-in-out infinite' }} />

          {/* REC 录制指示灯 */}
          <span
            className="absolute top-2 right-7 flex items-center gap-1 z-10"
            style={{ animation: 'bracket-breathe 2s ease-in-out infinite' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.7)]" />
            <span className="text-[8px] font-mono font-bold tracking-widest text-red-500/70">REC</span>
          </span>

          {/* 标题区 */}
          <div className="mb-5 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(14,14,44,.08)] bg-white/80 px-3 py-2 shadow-[0_1px_2px_rgba(14,14,44,.035),0_1px_5px_rgba(14,14,44,.025)]">
              <Image
                src="/nori-view/nori-onion-logo.png"
                alt="Nori"
                width={28}
                height={28}
                className="h-7 w-7 rounded-lg object-contain"
                priority
              />
              <span className="text-sm font-semibold text-[#0e0e2c]">Nori</span>
              {TEST_MODE_ENABLED && (
                <span className="rounded bg-[#D6FF00]/80 px-1.5 py-0.5 text-[10px] font-bold text-[#0e0e2c]">
                  TEST
                </span>
              )}
            </div>
          </div>
          <TypewriterHero title={t('title')} subtitle={t('subtitle')} />

          {/* 呼吸光晕 + 输入区域 */}
          <div className="w-full relative rounded-[22px] border border-[rgba(14,14,44,.08)] bg-white/90 p-2 shadow-[0_12px_28px_rgba(14,14,44,.075),0_2px_5px_rgba(14,14,44,.045)]">
            <StoryInputComposer
              value={inputValue}
              onValueChange={(nextValue) => {
                setInputValue(nextValue)
                if (createError) {
                  setCreateError(null)
                }
              }}
              placeholder={t('inputPlaceholder')}
              minRows={HOME_QUICK_START_MIN_ROWS}
              textareaClassName="px-0 pt-0 pb-3 align-top"
              videoRatio={videoRatio}
              onVideoRatioChange={setVideoRatio}
              ratioOptions={ratioOptions}
              artStyle={artStyle}
              onArtStyleChange={setArtStyle}
              styleOptions={styleOptions}
              customStyleOptions={customStyleOptions}
              onAddCustomStyle={handleAddCustomStyle}
              onEditCustomStyle={handleEditCustomStyle}
              onDeleteCustomStyle={handleDeleteCustomStyle}
              stylePresetValue={stylePresetValue}
              onStylePresetChange={setStylePresetValue}
              stylePresetOptions={STYLE_PRESETS}
              primaryAction={(
                <button
                  onClick={() => void handleCreate()}
                  disabled={!inputValue.trim() || createLoading}
                  className="glass-btn-base h-10 flex-shrink-0 px-5 text-sm disabled:opacity-50"
                  style={{
                    background: '#D6FF00',
                    color: '#0e0e2c',
                    border: '1px solid rgba(14,14,44,.12)',
                    boxShadow: '0 7px 18px rgba(14,14,44,.08), inset 0 -1px 0 rgba(14,14,44,.10)',
                  }}
                >
                  {createLoading ? tc('loading') : t('startCreation')}
                  <AppIcon name="arrowRight" className="w-4 h-4" />
                </button>
              )}
              secondaryActions={(
                <button
                  onClick={() => setAiWriteOpen(true)}
                  disabled={createLoading}
                  className="glass-btn-base flex h-10 flex-shrink-0 items-center gap-1.5 border border-[var(--glass-stroke-strong)] px-3 text-sm transition-all hover:border-[var(--glass-tone-info-fg)]/40"
                >
                  <AppIcon name="sparkles" className="w-4 h-4 text-[#7c3aed]" />
                  <span
                    className="font-medium"
                    style={{
                      background: 'linear-gradient(135deg, #3b82f6, #7c3aed)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {t('aiWrite.trigger')}
                  </span>
                </button>
              )}
              footer={createError ? (
                <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                  {createError}
                </p>
              ) : null}
            />
          </div>
        </div>
        {/* AI 帮我写模态框 */}
        <AiWriteModal
          open={aiWriteOpen}
          loading={aiWriteLoading}
          onClose={() => setAiWriteOpen(false)}
          onStart={(prompt) => void handleAiWriteStart(prompt)}
          t={(key: string) => t(`aiWrite.${key}`)}
        />

        {/* 自定义画风编辑模态框 */}
        <CustomArtStyleModal
          isOpen={customStyleModalOpen}
          editingStyle={editingCustomStyle}
          onSave={(data) => void handleSaveCustomStyle(data)}
          onClose={() => { setCustomStyleModalOpen(false); setEditingCustomStyleId(null) }}
        />
      </main>

      {/* 最近项目 */}
      <section className="px-4 sm:px-6 lg:px-10 pb-8 max-w-[1400px] mx-auto w-full">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-[var(--glass-text-secondary)]">{t('recentProjects')}</h2>
          <Link
            href={{ pathname: '/workspace' }}
            className="text-xs text-[var(--glass-tone-info-fg)] hover:underline font-medium"
          >
            {t('viewAll')}
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-surface p-5 animate-pulse">
                <div className="h-4 bg-[var(--glass-bg-muted)] rounded mb-3" />
                <div className="h-3 bg-[var(--glass-bg-muted)] rounded mb-2" />
                <div className="h-3 bg-[var(--glass-bg-muted)] rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 bg-[var(--glass-bg-muted)] rounded-xl flex items-center justify-center mx-auto mb-3">
              <AppIcon name="folderCards" className="w-6 h-6 text-[var(--glass-text-tertiary)]" />
            </div>
            <p className="text-sm text-[var(--glass-text-tertiary)]">{t('noProjects')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={{ pathname: `/workspace/${project.id}` }}
                className="glass-surface cursor-pointer group hover:border-[var(--glass-tone-info-fg)]/40 transition-all duration-300 overflow-hidden relative block"
              >
                <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="p-5 relative z-10">
                  <h3 className="text-sm font-bold text-[var(--glass-text-primary)] mb-2 group-hover:text-[var(--glass-tone-info-fg)] transition-colors line-clamp-1">
                    {project.name}
                  </h3>
                  {(project.description || project.stats?.firstEpisodePreview) && (
                    <div className="flex items-start gap-2 mb-3">
                      <AppIcon name="fileText" className="w-3.5 h-3.5 text-[var(--glass-text-tertiary)] mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-[var(--glass-text-secondary)] line-clamp-2 leading-relaxed">
                        {project.description || project.stats?.firstEpisodePreview}
                      </p>
                    </div>
                  )}
                  {project.stats && (project.stats.episodes > 0 || project.stats.images > 0 || project.stats.videos > 0) && (
                    <div className="flex items-center gap-2 mb-3">
                      <IconGradientDefs className="w-0 h-0 absolute" aria-hidden="true" />
                      <AppIcon name="statsBarGradient" className="w-4 h-4 flex-shrink-0" />
                      <div className="flex items-center gap-3 text-sm font-semibold bg-gradient-to-r from-blue-500 to-cyan-500 bg-clip-text text-transparent">
                        {project.stats.episodes > 0 && (
                          <span className="flex items-center gap-1">
                            <AppIcon name="statsEpisodeGradient" className="w-3.5 h-3.5" />
                            {project.stats.episodes}
                          </span>
                        )}
                        {project.stats.images > 0 && (
                          <span className="flex items-center gap-1">
                            <AppIcon name="statsImageGradient" className="w-3.5 h-3.5" />
                            {project.stats.images}
                          </span>
                        )}
                        {project.stats.videos > 0 && (
                          <span className="flex items-center gap-1">
                            <AppIcon name="statsVideoGradient" className="w-3.5 h-3.5" />
                            {project.stats.videos}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-[10px] text-[var(--glass-text-tertiary)]">
                    <AppIcon name="clock" className="w-3 h-3" />
                    {formatTimeAgo(project.updatedAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
