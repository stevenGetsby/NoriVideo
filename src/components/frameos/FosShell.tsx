'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Link, useRouter } from '@/i18n/navigation'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import {
  ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS,
  defaultSubaccountRoleLabel,
  hasAccountPermissions,
  isManagementRole,
} from '@/lib/account/permissions'
import { assignmentAttentionCount } from './assignments-view-model'
import { useAccountBalance, type DailyBalanceUsage } from '@/hooks/common/useAccountBalance'
import { FeedbackModal, AccountModal, UpdatesToast } from './FosShellModals'
import { FosCanvasShellContext } from './FosCanvasShellContext'
import { FosSidebarResizer } from './FosSidebarResizer'
import { useFosSidebarResize } from './useFosSidebarResize'
import { NoriBrandMark } from '@/components/brand/NoriBrandMark'

export type FosNavKey =
  | 'projects'
  | 'assignments'
  | 'screenwriter'
  | 'toolbox'
  | 'canvas'
  | 'interactive'
  | 'assetHub'
  | 'material'
  | 'accounts'
  | 'records'
  | 'feedback'
  | 'updates'

export interface FosProjectNavigation {
  projectId: string
  projectName: string
  activeItem: 'workbench' | 'canvas'
}

interface NavItem {
  key: FosNavKey
  label: string
  href: string
  icon: AppIconName
  badge?: string
}

const primaryNav: NavItem[] = [
  { key: 'projects', label: '我的项目', href: '/projects', icon: 'folder' },
  { key: 'assignments', label: '我的任务', href: '/my-assignments', icon: 'clipboardCheck' },
  { key: 'screenwriter', label: '编剧工作台', href: '/writer-workbench', icon: 'edit' },
  { key: 'toolbox', label: '工具箱', href: '/toolbox', icon: 'settingsHexMinor' },
  { key: 'canvas', label: '无限画布', href: '/canvas', icon: 'monitor' },
  { key: 'interactive', label: '影游画布', href: '/interactive', icon: 'film' },
  // Link to the canonical page directly. The legacy /asset-hub alias performs
  // a server redirect and briefly exposes the light document background.
  { key: 'assetHub', label: '资产库', href: '/workspace/asset-hub', icon: 'folderHeart' },
  { key: 'material', label: '素材库', href: '/material', icon: 'image' },
]

const secondaryNav: Array<{ key: 'records' | 'feedback' | 'updates'; label: string; icon: AppIconName }> = [
  { key: 'records', label: '服务记录', icon: 'receipt' },
  { key: 'feedback', label: '问题反馈', icon: 'infoCircle' },
  { key: 'updates', label: '检查更新', icon: 'refresh' },
]

const TEST_MODE = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'
const FOS_SIDEBAR_STORAGE_KEY = 'nori.fos.sidebarCollapsed'
const FOS_CANVAS_SIDEBAR_STORAGE_KEY = 'nori.fos.canvasSidebarCollapsed'

export function FosTitlebar({ title }: { title?: string }) {
  return (
    <div className="fos-titlebar" data-testid="fos-titlebar">
      {title ? <span className="fos-titlebar-title">{title}</span> : <span className="fos-titlebar-title">LanMiaoTV</span>}
      <button type="button" className="fos-titlebar-refresh" aria-label="刷新页面" title="刷新" onClick={() => window.location.reload()}>
        <AppIcon name="refresh" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function BalancePill({ points, dailyUsage, walletScope }: { points: number; dailyUsage: DailyBalanceUsage | null; walletScope: 'personal' | 'workspace' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const display = (value: number) => Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeWithEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeWithEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button type="button" className="fos-credits" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="fos-cr-badge blue">◆</span>
        <span className="fos-cr-label">{walletScope === 'workspace' ? '共享积分' : '积分'}</span>
        <span className={points <= 0 ? 'text-red-300' : ''}>{display(points)}</span>
      </button>
      {open ? (
        <div className="fos-balance-pop" role="menu">
          <h3>积分账户</h3>
          <div className="fos-bp-cards is-single">
            <div className="fos-bp-card">
              <div className="fos-bp-card-label">{walletScope === 'workspace' ? '管理账号共享可用积分' : '可用积分'}</div>
              <div className={`fos-bp-card-value${points <= 0 ? ' text-red-300' : ''}`}>{display(points)}</div>
              <div className="fos-bp-card-desc">¥1 = 100 积分 · {walletScope === 'workspace' ? '从管理账号共享钱包扣费，另按个人每日限额校验' : '积分不足会停止全部生成服务'}</div>
            </div>
          </div>
          {dailyUsage?.limitPoints != null ? (
            <div className="fos-bp-cards is-single">
              <div className="fos-bp-card">
                <div className="fos-bp-card-label">今日用量（管理账号设置）</div>
                <div className={`fos-bp-card-value${dailyUsage.exceeded ? ' text-red-300' : ''}`}>
                  {display(dailyUsage.usedPoints)} / {display(dailyUsage.limitPoints)}
                </div>
                <div className="fos-bp-card-desc">
                  {dailyUsage.exceeded
                    ? dailyUsage.limitPoints === 0
                      ? '管理账号已禁止生成，请联系管理账号调整为正数或 unlimited'
                      : '今日额度已用尽，明天 00:00 重置后可继续生成'
                    : `今日还剩 ${display(dailyUsage.remainingPoints ?? 0)} 积分 · 每天 00:00 重置`}
                </div>
              </div>
            </div>
          ) : null}
          <div className="fos-bp-actions">
            <Link href={{ pathname: '/service-records' }} role="menuitem" className="fos-btn fos-btn-primary fos-btn-sm flex-1" onClick={() => setOpen(false)}>查看明细</Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function FosHeader({ canvasMode = false }: { canvasMode?: boolean }) {
  const { data: session } = useSession()
  const { points, dailyUsage, walletScope } = useAccountBalance()
  const role = session?.user?.role
  const roleLabel = role === 'super_admin'
    ? '平台 Admin · 全部权限'
    : role === 'admin'
      ? '管理账号 · 全部权限'
      : `${session?.user?.roleLabel || defaultSubaccountRoleLabel(role)} · ${ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS
        .filter((definition) => session?.user?.permissions?.includes(definition.key))
        .map((definition) => definition.label)
        .join(' / ') || '仅查看'}`
  return (
    <div className="fos-header">
      <Link href={{ pathname: '/projects' }} className="fos-logo">
        <NoriBrandMark className="fos-logo-mark" />
        <span className="fos-logo-text"><span className="a">LanMiao</span><span className="b">TV</span></span>
      </Link>
      <div className={`fos-header-actions flex items-center${canvasMode ? '' : ' gap-4'}`}>
        {!canvasMode && session ? (
          <span className="hidden rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-[10px] text-white/50 lg:inline-flex">
            {roleLabel}
          </span>
        ) : null}
        <BalancePill points={points} dailyUsage={dailyUsage} walletScope={walletScope} />
      </div>
    </div>
  )
}

function NavLink({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  const attention = typeof count === 'number' && count > 0 ? count : 0
  return (
    <Link href={{ pathname: item.href }} className={`fos-nav-item${active ? ' active' : ''}`} data-nav={item.key}>
      <span className="fos-nav-icon"><AppIcon name={item.icon} /></span>
      <span className="min-w-0 truncate">
        {item.label}
        {item.badge ? <span className="badge-new">{item.badge}</span> : null}
      </span>
      {attention > 0 ? (
        <span className="fos-nav-count" data-testid={item.key === 'assignments' ? 'assignment-nav-count' : undefined} aria-label={`${attention} 条待处理任务`}>
          {attention > 99 ? '99+' : attention}
        </span>
      ) : null}
    </Link>
  )
}

function useAssignmentAttention(enabled: boolean) {
  const { data: session } = useSession()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!enabled || !session?.user?.id) {
      setCount(0)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const response = await apiFetch('/api/collaboration/assignments/counts', { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json() as { data?: { counts?: { todo?: unknown; pendingReview?: unknown } }; counts?: { todo?: unknown; pendingReview?: unknown } }
        const counts = payload.data?.counts ?? payload.counts
        const next = assignmentAttentionCount({
          todo: Number(counts?.todo) || 0,
          pendingReview: Number(counts?.pendingReview) || 0,
        })
        if (!cancelled) setCount(next)
      } catch {
        // Keep the last visible count during a transient network failure.
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [enabled, session?.user?.id])

  return count
}

function Sidebar({
  activeKey,
  projectNavigation,
  collapsed,
  canvasMode,
  onToggle,
  resizeHandle,
}: {
  activeKey: FosNavKey
  projectNavigation?: FosProjectNavigation
  collapsed: boolean
  canvasMode: boolean
  onToggle: () => void
  resizeHandle: ReactNode
}) {
  const { data: session } = useSession()
  const locale = useLocale()
  const account = session?.user?.name || session?.user?.email?.split('@')[0] || (TEST_MODE ? '测试账号' : '当前账号')
  const isAdmin = session?.user?.role === 'admin'
  const roleLabel = isManagementRole(session?.user?.role)
    ? session?.user?.role === 'super_admin' ? '平台 Admin' : '管理账号'
    : session?.user?.roleLabel || defaultSubaccountRoleLabel(session?.user?.role)
  const canUseToolbox = hasAccountPermissions(session?.user || {}, ['toolboxUse'])
  const canUseCanvas = hasAccountPermissions(session?.user || {}, ['canvasWrite'])
  const canUseWriterWorkbench = hasAccountPermissions(session?.user || {}, ['scriptWrite'])
  const assignmentAttention = useAssignmentAttention(!collapsed)
  const visiblePrimaryNav = primaryNav.filter((item) => (
    (item.key !== 'toolbox' || canUseToolbox)
    && ((item.key !== 'canvas' && item.key !== 'interactive') || canUseCanvas)
    && (item.key !== 'screenwriter' || canUseWriterWorkbench)
  ))
  const params = useSearchParams()
  const initialPanel = ((): 'feedback' | 'account' | null => {
    const p = params?.get('panel')
    return p === 'feedback' || p === 'account' ? p : null
  })()
  const [modal, setModal] = useState<'feedback' | 'account' | null>(initialPanel)
  const [toast, setToast] = useState(false)

  useEffect(() => {
    if (!collapsed) return
    setModal(null)
    setToast(false)
  }, [collapsed])

  const onFooter = (key: 'feedback' | 'updates') => {
    if (key === 'updates') { setToast(true); return }
    setModal(key)
  }

  const handleSignOut = () => {
    void signOut({ callbackUrl: `/${locale}/auth/signin` })
  }

  return (
    <aside
      className={`fos-sidebar${collapsed ? ' is-collapsed' : ''}`}
      aria-label="主导航侧栏"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-testid="fos-sidebar"
      onClickCapture={(event) => {
        if (!canvasMode || collapsed) return
        const target = event.target
        if (target instanceof HTMLElement && target.closest('a')) onToggle()
      }}
    >
      <div className="fos-sidebar-header">
        <button
          type="button"
          className="fos-collapse-btn"
          title={`${collapsed ? '展开' : '收起'}菜单（⌘/Ctrl+B）`}
          aria-label={collapsed ? '展开侧边菜单' : '收起侧边菜单'}
          aria-controls="fos-sidebar-sections"
          aria-expanded={!collapsed}
          data-testid="fos-sidebar-toggle"
          onClick={onToggle}
        >
          <AppIcon name={collapsed ? 'chevronRight' : 'chevronLeft'} className="h-4 w-4" />
        </button>
      </div>
      <div id="fos-sidebar-sections" className="fos-sidebar-sections" hidden={collapsed}>
        <nav className="fos-nav">
          {visiblePrimaryNav.map((item) => (
            <NavLink
              key={item.key}
              item={item}
              active={item.key === activeKey && !projectNavigation}
              count={item.key === 'assignments' ? assignmentAttention : undefined}
            />
          ))}
          {projectNavigation ? (
            <section className="fos-project-nav" aria-label="当前作品导航">
              <div className="fos-project-nav-heading">
                <span>当前作品</span>
                <strong title={projectNavigation.projectName}>{projectNavigation.projectName}</strong>
              </div>
              <Link
                href={{ pathname: `/workflow/${projectNavigation.projectId}/workbench-premium2` }}
                className={`fos-nav-item${projectNavigation.activeItem === 'workbench' ? ' active' : ''}`}
                data-testid="project-workbench-nav"
                data-nav="workbench"
              >
                <span className="fos-nav-icon"><AppIcon name="folderOpen" /></span>
                <span className="min-w-0 truncate">作品工作台</span>
              </Link>
              {canUseCanvas ? (
                <Link
                  href={{ pathname: `/workflow/${projectNavigation.projectId}/workbench-premium2/canvas` }}
                  className={`fos-nav-item fos-project-canvas-link${projectNavigation.activeItem === 'canvas' ? ' active' : ''}`}
                  data-testid="project-canvas-nav"
                  data-nav="canvas"
                >
                  <span className="fos-nav-icon"><AppIcon name="clapperboard" /></span>
                  <span className="min-w-0 truncate">无限画布</span>
                  <span className="fos-project-canvas-badge">CANVAS</span>
                </Link>
              ) : null}
            </section>
          ) : null}
        </nav>
        <div className="fos-sidebar-footer">
          {isAdmin ? (
            <Link href={{ pathname: '/account-management' }} className={`fos-nav-item${activeKey === 'accounts' ? ' active' : ''}`}>
              <AppIcon name="userRoundCog" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">子账号管理</span>
            </Link>
          ) : null}
          {secondaryNav.map((item) => (
            item.key === 'records' ? (
              <Link key={item.key} href={{ pathname: '/service-records' }} className={`fos-nav-item${activeKey === 'records' ? ' active' : ''}`}>
                <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{item.label}</span>
              </Link>
            ) : (
              <button key={item.key} type="button" className="fos-nav-item" onClick={() => onFooter(item.key === 'feedback' ? 'feedback' : 'updates')}>
                <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{item.label}</span>
              </button>
            )
          ))}
          <div className="fos-user-card">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setModal('account')}>
              <span className="fos-user-avatar"><AppIcon name="user" className="h-4 w-4" /></span>
              <span className="fos-user-meta">
                <span className="fos-user-name">{account}</span>
                <span className="fos-user-role">{roleLabel}</span>
              </span>
            </button>
            <button type="button" className="fos-user-logout" title="退出登录" aria-label="退出登录" onClick={handleSignOut}>
              <AppIcon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {!collapsed && modal === 'feedback' ? <FeedbackModal onClose={() => setModal(null)} /> : null}
      {!collapsed && modal === 'account' ? <AccountModal account={account} onLogout={handleSignOut} onClose={() => setModal(null)} /> : null}
      {!collapsed && toast ? <UpdatesToast onDone={() => setToast(false)} /> : null}
      {resizeHandle}
    </aside>
  )
}

export function FosShell({
  activeKey,
  children,
  hideSidebar = false,
  canvasShell = false,
  titlebarTitle,
  header,
  projectNavigation,
}: {
  activeKey: FosNavKey
  children: ReactNode
  hideSidebar?: boolean
  canvasShell?: boolean
  titlebarTitle?: string
  header?: ReactNode
  projectNavigation?: FosProjectNavigation
}) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const locale = useLocale()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(canvasShell)
  const { sidebarWidth, sidebarResizing, beginSidebarResize, resetSidebarWidth } = useFosSidebarResize()

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current
      try {
        if (canvasShell) window.localStorage.setItem(FOS_CANVAS_SIDEBAR_STORAGE_KEY, next ? 'true' : 'false')
        else window.localStorage.setItem(FOS_SIDEBAR_STORAGE_KEY, next ? 'true' : 'false')
      } catch {
        // Storage can be unavailable in private/restricted browser contexts.
      }
      return next
    })
  }, [canvasShell])

  useEffect(() => {
    if (hideSidebar) return
    const narrowViewport = window.matchMedia('(max-width: 760px)')
    const restoreSidebar = () => {
      // A desktop "expanded" preference must not squeeze the project/work
      // hierarchy into a narrow strip on a small display.
      if (narrowViewport.matches) {
        setSidebarCollapsed(true)
        return
      }
      try {
        const stored = canvasShell
          ? window.localStorage.getItem(FOS_CANVAS_SIDEBAR_STORAGE_KEY)
          : window.localStorage.getItem(FOS_SIDEBAR_STORAGE_KEY)
        setSidebarCollapsed(stored === null ? canvasShell : stored === 'true')
      } catch {
        setSidebarCollapsed(canvasShell)
      }
    }
    restoreSidebar()
    narrowViewport.addEventListener('change', restoreSidebar)
    return () => narrowViewport.removeEventListener('change', restoreSidebar)
  }, [canvasShell, hideSidebar])

  useEffect(() => {
    if (hideSidebar) return
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.shiftKey || (!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== 'b') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
      event.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [hideSidebar, toggleSidebar])

  useEffect(() => {
    if (status === 'loading' || session || TEST_MODE) return
    router.replace({ pathname: '/auth/signin' })
  }, [router, session, status])

  useEffect(() => {
    if (status !== 'authenticated' || session?.user?.role !== 'super_admin') return
    router.replace({ pathname: '/admin/accounts' })
  }, [router, session?.user?.role, status])

  useEffect(() => {
    if (!session?.user?.status || session.user.status === 'active') return
    void signOut({ callbackUrl: `/${locale}/auth/signin` })
  }, [locale, session])

  const canvasShellState = useMemo(() => ({
    enabled: canvasShell,
    sidebarCollapsed,
    toggleSidebar,
  }), [canvasShell, sidebarCollapsed, toggleSidebar])

  if (status === 'loading' || (!session && !TEST_MODE) || session?.user?.role === 'super_admin') {
    return <div className="fos-app"><div className="fos-loading">正在验证账号…</div></div>
  }

  const canAccess = TEST_MODE || activeKey !== 'accounts' || session?.user?.role === 'admin'
  if (!canAccess) {
    return (
      <div className="fos-app flex items-center justify-center">
        <div className="max-w-md rounded-[12px] border border-white/10 bg-white/[.035] p-8 text-center">
          <AppIcon name="lock" className="mx-auto h-7 w-7 text-white/40" />
          <h1 className="mt-4 text-[16px] font-bold text-white">没有访问权限</h1>
          <p className="mt-2 text-[12px] leading-6 text-white/45">仅管理账号可以进入子账号管理。</p>
        </div>
      </div>
    )
  }

  return (
    <FosCanvasShellContext.Provider value={canvasShellState}>
      <div
        className={`fos-app${canvasShell ? ` is-canvas-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : 'is-sidebar-expanded'}` : ''}${sidebarResizing ? ' is-sidebar-resizing' : ''}`}
        style={{ '--fos-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <FosTitlebar title={titlebarTitle} />
        <FosHeader canvasMode={canvasShell} />
        <div className="fos-content">
          {hideSidebar ? null : (
            <Sidebar
              activeKey={activeKey}
              projectNavigation={projectNavigation}
              collapsed={sidebarCollapsed}
              canvasMode={canvasShell}
              onToggle={toggleSidebar}
              resizeHandle={<FosSidebarResizer collapsed={sidebarCollapsed} resizing={sidebarResizing} onPointerDown={beginSidebarResize} onDoubleClick={resetSidebarWidth} />}
            />
          )}
          <main className="fos-main">
            {header}
            {children}
          </main>
        </div>
      </div>
    </FosCanvasShellContext.Provider>
  )
}
