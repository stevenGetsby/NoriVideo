'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'

export type FosNavKey =
  | 'projects'
  | 'toolbox'
  | 'seedance'
  | 'assetHub'
  | 'material'
  | 'records'
  | 'feedback'
  | 'updates'

interface NavItem {
  key: FosNavKey
  label: string
  href: string
  icon: AppIconName
  badge?: string
}

const primaryNav: NavItem[] = [
  { key: 'projects', label: '我的项目', href: '/projects', icon: 'folder' },
  { key: 'toolbox', label: '工具箱', href: '/toolbox', icon: 'settingsHexMinor' },
  { key: 'seedance', label: 'Seedance 2.0', href: '/seedance', icon: 'film', badge: 'HOT' },
  { key: 'assetHub', label: '资产库', href: '/asset-hub', icon: 'folderHeart' },
  { key: 'material', label: '素材库', href: '/material', icon: 'image' },
]

const secondaryNav: NavItem[] = [
  { key: 'records', label: '服务记录', href: '/service-records', icon: 'receipt' },
  { key: 'feedback', label: '问题反馈', href: '/feedback', icon: 'infoCircle' },
]

interface Balance {
  coins: number
  points: number
}

export function FosTitlebar() {
  return null
}

function BalancePill({ balance }: { balance: Balance }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button type="button" className="fos-credits" onClick={() => setOpen((v) => !v)} onMouseEnter={() => setOpen(true)}>
        <span className="fos-cr-badge orange">¥</span>
        <span>{balance.coins}</span>
        <span className="fos-cr-divider" />
        <span className="fos-cr-badge blue">◆</span>
        <span>{balance.points}</span>
      </button>
      {open ? (
        <div className="fos-balance-pop">
          <h3>余额</h3>
          <div className="fos-bp-cards">
            <div className="fos-bp-card">
              <div className="fos-bp-card-label">金币</div>
              <div className="fos-bp-card-value">{balance.coins}</div>
              <div className="fos-bp-card-desc">畅享全部模型</div>
            </div>
            <div className="fos-bp-card">
              <div className="fos-bp-card-label">积分</div>
              <div className="fos-bp-card-value">{balance.points}</div>
              <div className="fos-bp-card-desc">可体验部分模型</div>
            </div>
          </div>
          <div className="fos-bp-actions">
            <button type="button" className="fos-btn fos-btn-primary fos-btn-sm flex-1" disabled title="充值入口已禁用（演示）">立即充值</button>
            <Link href={{ pathname: '/service-records' }} className="fos-btn fos-btn-ghost fos-btn-sm flex-1">查看明细</Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function FosHeader({ balance }: { balance: Balance }) {
  return (
    <div className="fos-header">
      <Link href={{ pathname: '/projects' }} className="fos-logo">
        <span className="fos-logo-mark"><i /><i /><i /></span>
        <span className="fos-logo-text"><span className="a">Nori</span><span className="b">Video</span></span>
      </Link>
      <div className="flex items-center gap-4">
        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" style={{ borderRadius: 9999 }}>
          <AppIcon name="download" className="h-3.5 w-3.5" />下载桌面端
        </button>
        <BalancePill balance={balance} />
      </div>
    </div>
  )
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link href={{ pathname: item.href }} className={`fos-nav-item${active ? ' active' : ''}`}>
      <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate">
        {item.label}
        {item.badge ? <span className="badge-new">{item.badge}</span> : null}
      </span>
    </Link>
  )
}

function Sidebar({ activeKey }: { activeKey: FosNavKey }) {
  const { data: session } = useSession()
  const account = session?.user?.name || session?.user?.email?.split('@')[0] || 'xuyizhao'
  return (
    <aside className="fos-sidebar">
      <div className="fos-sidebar-header">
        <button type="button" className="fos-collapse-btn" title="收起菜单">
          <AppIcon name="chevronLeft" className="h-4 w-4" />
        </button>
      </div>
      <nav className="fos-nav">
        {primaryNav.map((item) => <NavLink key={item.key} item={item} active={item.key === activeKey} />)}
      </nav>
      <div className="fos-sidebar-footer">
        {secondaryNav.map((item) => <NavLink key={item.key} item={item} active={item.key === activeKey} />)}
        <div className="fos-user-card">
          <span className="fos-user-avatar"><AppIcon name="user" className="h-4 w-4" /></span>
          <span className="fos-user-meta">
            <span className="fos-user-name">{account}</span>
            <span className="fos-user-role">子账号</span>
          </span>
          <button type="button" className="fos-user-logout" title="退出登录（演示已禁用）" disabled>
            <AppIcon name="logout" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}

export function FosShell({
  activeKey,
  balance = { coins: -683, points: 0 },
  children,
  hideSidebar = false,
  header,
}: {
  activeKey: FosNavKey
  balance?: Balance
  children: ReactNode
  hideSidebar?: boolean
  header?: ReactNode
}) {
  return (
    <div className="fos-app">
      <FosTitlebar />
      <FosHeader balance={balance} />
      <div className="fos-content">
        {hideSidebar ? null : <Sidebar activeKey={activeKey} />}
        <main className="fos-main">
          {header}
          {children}
        </main>
      </div>
    </div>
  )
}
