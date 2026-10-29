import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('LanmiaoTV service record surface', () => {
  it('routes every service-record entry to the real usage page instead of a static modal', () => {
    const shell = source('src/components/frameos/FosShell.tsx')
    const modals = source('src/components/frameos/FosShellModals.tsx')
    const page = source('src/app/[locale]/service-records/page.tsx')

    expect(shell).toContain("href={{ pathname: '/service-records' }}")
    expect(shell).not.toContain("modal === 'records'")
    expect(modals).not.toContain('export function ServiceRecordsModal')
    expect(modals).not.toContain('修改密码')
    expect(modals).not.toContain('演示已禁用')
    expect(page).toContain('<FosShell activeKey="records">')
    expect(page).toContain('<FrameServiceRecordsDashboard />')
    expect(page).toContain('查看真实任务、作品消耗、账户流水、失败原因和服务使用统计。')
  })
})
