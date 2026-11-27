'use client'

import type { ReactNode } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon, ShieldCheck, type AppIconName } from '@/components/ui/icons'
import { NoriBrandMark } from '@/components/brand/NoriBrandMark'
import { statTileStyle } from '@/components/workspace/stat-tile-hue'
import './admin-console.css'

export type AdminNavKey = 'services' | 'models' | 'customer-models' | 'accounts' | 'usage' | 'mp-review' | 'mp-ops' | 'mp-stats'

interface NavItem {
  key: AdminNavKey
  href: string
  label: string
  caption: string
  icon: AppIconName
  group: 'core' | 'mp'
}

const NAV: NavItem[] = [
  { key: 'services', href: 'services', label: '服务商与密钥', caption: '上游连接、密钥与健康', icon: 'unplug', group: 'core' },
  { key: 'models', href: 'models', label: '模型与路由', caption: '全局开关、路由与喵导', icon: 'cpu', group: 'core' },
  { key: 'customer-models', href: 'customer-models', label: '客户模型策略', caption: '白标视图、单客与白名单', icon: 'userRoundCog', group: 'core' },
  { key: 'accounts', href: 'accounts', label: '账号与积分', caption: '客户主账号、额度与账本', icon: 'usersRound', group: 'core' },
  { key: 'usage', href: 'usage', label: '存储与用量', caption: 'TOS 存储与成本对账', icon: 'chart', group: 'core' },
  { key: 'mp-review', href: 'mp-review', label: '内容审核', caption: '小程序作品版本审核', icon: 'clipboardCheckSolid', group: 'mp' },
  { key: 'mp-ops', href: 'mp-ops', label: '内容运营', caption: '推荐位、专题、渠道、举报', icon: 'sparkles', group: 'mp' },
  { key: 'mp-stats', href: 'mp-stats', label: '小程序数据', caption: '用户、游玩与渠道', icon: 'statsBarGradient', group: 'mp' },
]

const NAV_GROUPS: Array<{ key: 'core' | 'mp'; label: string }> = [
  { key: 'core', label: '核心平台' },
  { key: 'mp', label: '小程序中心' },
]

const SIDEBAR_NOTES: Record<AdminNavKey, { icon: AppIconName; tone?: 'warn'; text: string }> = {
  services: {
    icon: 'alert',
    tone: 'warn',
    text: 'API Key 保存后立即热加载并自动检测连接；修改会影响全部上游模型调用。',
  },
  models: {
    icon: 'alert',
    tone: 'warn',
    text: '此处控制全局视频模型开关、默认底层路由与喵导模型，保存后立即对全平台生效。',
  },
  'customer-models': {
    icon: 'infoCircle',
    text: '客户模型策略按主账号配置，自动覆盖名下全部子账号；内部白名单账号不受白标限制。',
  },
  accounts: {
    icon: 'infoCircle',
    text: '此处创建客户主账号并管理积分额度。子账号、项目组长与项目成员由对应主账号在 LanmiaoTV 内维护。',
  },
  usage: {
    icon: 'infoCircle',
    text: '可检测 TOS 素材存储连通性，并按服务商与模型维度核对上游调用用量及估算成本。',
  },
  'mp-review': {
    icon: 'infoCircle',
    text: '通过或驳回都会记录审核人与时间；驳回原因对创作者可见。',
  },
  'mp-ops': {
    icon: 'infoCircle',
    text: '推荐位与专题只在生效时间内展示；封禁立即对观众生效。',
  },
  'mp-stats': {
    icon: 'infoCircle',
    text: '数据每 10 分钟聚合一次，按北京时间统计。',
  },
}

export function AdminBrand() {
  return (
    <div className="nori-admin-brand">
      <NoriBrandMark className="fos-logo-mark" />
      <span className="fos-logo-text"><span className="a">LanMiao</span><span className="b">TV</span></span>
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
  const hue = tone || ({
    管理账号: 'projects',
    启用中: 'activeTasks',
    角色子账号: 'subaccounts',
    管理账号积分: 'ideas',
    文本模型: 'text',
    图片模型: 'image',
    视频模型: 'video',
    语音模型: 'audio',
    外部服务: 'workflow',
    已配密钥: 'ideas',
    健康服务: 'activeTasks',
    已开视频模型: 'video',
    已路由能力: 'projects',
    喵导已开放: 'quality',
    接入底层模型: 'workflow',
    全局白标模型: 'ideas',
    独立策略客户: 'video',
    客户主账号: 'projects',
    内部白名单: 'workflow',
    存储状态: 'activeTasks',
    'TOS 已登记': 'assets',
    估算上游成本: 'quality',
  }[label] || 'total')
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
  onDismiss,
}: {
  tone: 'error' | 'success' | 'warning'
  children: ReactNode
  action?: ReactNode
  onDismiss?: () => void
}) {
  const icon: AppIconName = tone === 'success' ? 'badgeCheck' : 'alert'
  return (
    <div className={`nori-admin-alert ${tone === 'success' ? 'is-ok' : tone === 'warning' ? 'is-warn' : 'is-error'}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="nori-admin-alert-body">
        <AppIcon name={icon} className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{children}</span>
      </div>
      {(action || onDismiss) ? (
        <div className="nori-admin-alert-actions">
          {action}
          {onDismiss ? (
            <button type="button" className="nori-admin-alert-dismiss" aria-label="关闭提示" onClick={onDismiss}>
              <AppIcon name="close" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
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
      <input
        className="fos-input"
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {value ? (
        <button
          type="button"
          className="nori-admin-search-clear"
          aria-label="清空搜索"
          onClick={() => onChange('')}
        >
          <AppIcon name="close" />
        </button>
      ) : null}
    </label>
  )
}

export function AdminEmpty({
  children,
  icon,
  description,
}: {
  children: ReactNode
  icon?: AppIconName
  description?: string
}) {
  return (
    <div className="nori-admin-panel nori-admin-empty">
      {icon ? <span className="nori-admin-empty-icon"><AppIcon name={icon} className="h-4 w-4" /></span> : null}
      <span>{children}</span>
      {description ? <p className="nori-admin-empty-desc">{description}</p> : null}
    </div>
  )
}

export function AdminLoading({ label = '正在加载数据…' }: { label?: string }) {
  return (
    <div className="nori-admin-panel nori-admin-loading" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-[12px] nori-admin-muted">
        <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
      </div>
      <div className="nori-admin-skeleton-row w-2/3" />
      <div className="nori-admin-skeleton-row w-full" />
      <div className="nori-admin-skeleton-row w-4/5" />
    </div>
  )
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
        <div className="nori-admin-header-left">
          <AdminBrand />
          <div className="nori-admin-breadcrumb" aria-label="当前位置">
            <span>{eyebrow}</span>
            <AppIcon name="chevronRight" />
            <strong>{title}</strong>
          </div>
        </div>
        <div className="nori-admin-header-end">
          <span className="nori-admin-environment"><i />LanmiaoTV 控制台</span>
          <span className="nori-admin-role-pill">
            <ShieldCheck />
            平台最高管理员
          </span>
          <button
            type="button"
            className="nori-admin-logout"
            aria-label="退出管理控制台"
            onClick={() => void signOut({ callbackUrl: `/${locale}/admin/signin` })}
          >
            <AppIcon name="logout" className="h-4 w-4" /><span>退出</span>
          </button>
        </div>
      </header>

      <div className="nori-admin-layout">
        <aside className="nori-admin-sidebar">
          <div className="nori-admin-sidebar-inner">
            {NAV_GROUPS.map((group) => (
              <div key={group.key} className="nori-admin-nav-group">
                <p className="nori-admin-nav-label">{group.label}</p>
                <nav className="nori-admin-nav" aria-label={group.label}>
                  {NAV.filter((item) => item.group === group.key).map((item) => (
                    <Link
                      key={item.key}
                      href={`/admin/${item.href}`}
                      aria-current={item.key === active ? 'page' : undefined}
                      className={`nori-admin-nav-item${item.key === active ? ' is-active' : ''}`}
                      data-nav={item.key}
                    >
                      <span className="nori-admin-nav-icon"><AppIcon name={item.icon} className="h-4 w-4 shrink-0" /></span>
                      <span><strong>{item.label}</strong><small>{item.caption}</small></span>
                    </Link>
                  ))}
                </nav>
              </div>
            ))}
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
          <div className="nori-admin-content-inner">
            <nav className="nori-admin-mobile-nav" aria-label="平台管理导航">
              {NAV.map((item) => (
                <Link key={item.key} href={`/admin/${item.href}`} aria-current={item.key === active ? 'page' : undefined} className={item.key === active ? 'is-active' : undefined}>
                  <AppIcon name={item.icon} />{item.label}
                </Link>
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
          </div>
        </section>
      </div>
    </main>
  )
}
