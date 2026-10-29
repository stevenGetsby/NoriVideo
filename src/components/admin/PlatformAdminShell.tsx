'use client'

import type { ReactNode } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { NoriBrandMark } from '@/components/brand/NoriBrandMark'
import { statTileStyle } from '@/components/workspace/stat-tile-hue'

export type AdminNavKey = 'accounts' | 'services'

const NAV: Array<{ key: AdminNavKey; href: string; label: string; caption: string; icon: AppIconName }> = [
  { key: 'accounts', href: 'accounts', label: '账号与用量', caption: '工作区、额度与账本', icon: 'usersRound' },
  { key: 'services', href: 'services', label: '服务配置', caption: '模型、存储与健康', icon: 'settingsHex' },
]

const SIDEBAR_NOTES: Record<AdminNavKey, { icon: AppIconName; tone?: 'warn'; text: string }> = {
  accounts: {
    icon: 'infoCircle',
    text: '此处创建管理账号并查看整个工作区用量。角色子账号、功能区权限和作品审核员由对应管理账号在 LanmiaoTV 内维护。',
  },
  services: {
    icon: 'alert',
    tone: 'warn',
    text: '这里修改的是全平台服务，保存后会影响全部管理账号和角色子账号。',
  },
}

export function AdminBrand() {
  return (
    <div className="nori-admin-brand">
      <NoriBrandMark className="fos-logo-mark" />
      <span className="fos-logo-text"><span className="a">Lanmiao</span><span className="b">TV</span></span>
      <span className="nori-admin-brand-badge">Admin</span>
    </div>
  )
}

export function AdminMetric({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: ReactNode
  icon: AppIconName
  tone?: string
}) {
  const hue = tone || ({ 管理账号: 'projects', 启用中: 'activeTasks', 角色子账号: 'subaccounts', 管理账号积分: 'ideas', 文本模型: 'text', 图片模型: 'image', 视频模型: 'video', 语音模型: 'audio', 外部服务: 'workflow', 健康服务: 'activeTasks' }[label] || 'total')
  return (
    <div className="nori-admin-metric fos-stat-tile" style={statTileStyle(hue)}>
      <div className="nori-admin-metric-top">
        <span>{label}</span>
        <span className="nori-admin-metric-icon"><AppIcon name={icon} className="h-4 w-4" /></span>
      </div>
      <strong>{value}</strong>
    </div>
  )
}

export function AdminAlert({
  tone,
  children,
  action,
}: {
  tone: 'error' | 'success' | 'warning'
  children: ReactNode
  action?: ReactNode
}) {
  const icon: AppIconName = tone === 'success' ? 'badgeCheck' : tone === 'warning' ? 'alert' : 'alert'
  return (
    <div className={`nori-admin-alert ${tone === 'success' ? 'is-ok' : tone === 'warning' ? 'is-warn' : 'is-error'}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="nori-admin-alert-body">
        <AppIcon name={icon} className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{children}</span>
      </div>
      {action}
    </div>
  )
}

export function AdminSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="nori-admin-search">
      <AppIcon name="search" />
      <input className="fos-input" aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <div className="nori-admin-panel nori-admin-empty">{children}</div>
}

export function AdminHealthBadge({
  status,
  latencyMs,
  missingLabel = '未检测',
}: {
  status?: 'healthy' | 'unhealthy'
  latencyMs?: number | null
  missingLabel?: string
}) {
  if (!status) {
    return <span className="nori-admin-health"><i />{missingLabel}</span>
  }
  const ok = status === 'healthy'
  return (
    <span className={`nori-admin-health ${ok ? 'is-ok' : 'is-bad'}`}>
      <i />
      {ok ? '正常' : '异常'}{latencyMs != null ? ` · ${latencyMs}ms` : ''}
    </span>
  )
}

export function PlatformAdminShell({
  active,
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  active: AdminNavKey
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  const { data: session } = useSession()
  const locale = useLocale()
  const username = session?.user?.name || 'Platform Admin'
  const note = SIDEBAR_NOTES[active]
  const current = NAV.find((item) => item.key === active) || NAV[0]

  return (
    <main className="nori-admin">
      <header className="nori-admin-header">
        <AdminBrand />
        <div className="nori-admin-header-end">
          <span className="nori-admin-environment"><i />LanmiaoTV 控制台</span>
          <span className="nori-admin-role-pill">平台最高管理员</span>
          <button type="button" className="nori-admin-logout" aria-label="退出管理控制台" onClick={() => void signOut({ callbackUrl: `/${locale}/admin/signin` })}>
            <AppIcon name="logout" className="h-4 w-4" /><span>退出</span>
          </button>
        </div>
      </header>

      <div className="nori-admin-layout">
        <aside className="nori-admin-sidebar">
          <div className="nori-admin-sidebar-inner">
            <p className="nori-admin-nav-label">平台管理</p>
            <nav className="nori-admin-nav" aria-label="平台管理导航">
              {NAV.map((item) => (
                <Link key={item.key} href={`/admin/${item.href}`} aria-current={item.key === active ? 'page' : undefined} className={`nori-admin-nav-item${item.key === active ? ' is-active' : ''}`} data-nav={item.key}>
                  <span className="nori-admin-nav-icon"><AppIcon name={item.icon} className="h-4 w-4 shrink-0" /></span>
                  <span><strong>{item.label}</strong><small>{item.caption}</small></span>
                </Link>
              ))}
            </nav>
            <div className="nori-admin-sidebar-footer">
              <div className={`nori-admin-sidebar-note${note.tone === 'warn' ? ' is-warn' : ''}`}>
                <AppIcon name={note.icon} className="h-3.5 w-3.5" />
                <p>{note.text}</p>
              </div>
              <div className="nori-admin-user-card">
                <span className="nori-admin-user-avatar">{username.slice(0, 1).toUpperCase()}</span>
                <div className="nori-admin-user-meta">
                  <strong>{username}</strong>
                  <span>平台 Admin</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="nori-admin-content">
          <nav className="nori-admin-mobile-nav" aria-label="平台管理导航">
            {NAV.map((item) => (
              <Link key={item.key} href={`/admin/${item.href}`} aria-current={item.key === active ? 'page' : undefined} className={item.key === active ? 'is-active' : undefined}><AppIcon name={item.icon} />{item.label}</Link>
            ))}
          </nav>
          <div className="nori-admin-pagehead">
            <div className="nori-admin-pagehead-copy">
              <span className="nori-admin-pagehead-icon"><AppIcon name={current.icon} /></span>
              <div>
                <span className="nori-admin-kicker">{eyebrow}</span>
                <h1 className="nori-admin-title">{title}</h1>
                <p className="nori-admin-lead">{description}</p>
              </div>
            </div>
            {actions ? <div className="nori-admin-pagehead-actions">{actions}</div> : null}
          </div>
          {children}
        </section>
      </div>
    </main>
  )
}
