'use client'

import { Link } from '@/i18n/navigation'

export function TeamManagementTabs({ active }: { active: 'members' | 'activity' }) {
  const tabs = [
    { key: 'members' as const, label: '成员与积分', href: '/account-management' },
    { key: 'activity' as const, label: '工作监督', href: '/account-management/activity' },
  ]
  return (
    <nav className="fos-seg mb-5" aria-label="团队管理标签" data-testid="team-management-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={{ pathname: tab.href }}
          className={`fos-seg-opt${active === tab.key ? ' active' : ''}`}
          aria-current={active === tab.key ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
