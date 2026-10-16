import { describe, expect, it } from 'vitest'
import {
  buildAccountModelUsageCsv,
  buildAccountModelUsageRows,
  type ServiceUsageRecord,
} from '@/lib/workspace/service-records-export'

function record(overrides: Partial<ServiceUsageRecord> = {}): ServiceUsageRecord {
  return {
    accountId: 'account-1',
    accountName: '蓝喵',
    accountRole: '分镜师',
    projectId: 'project-1',
    serviceType: 'text',
    modelKey: 'deepseek-chat',
    modelName: 'DeepSeek Chat',
    status: 'success',
    inputTokens: 100,
    outputTokens: 30,
    units: 1,
    cost: 0.2,
    points: 2,
    createdAt: '2026-07-30T08:00:00.000Z',
    ...overrides,
  }
}

describe('service record account/model export', () => {
  it('aggregates usage by account and model', () => {
    const rows = buildAccountModelUsageRows([
      record(),
      record({ projectId: 'project-2', status: 'failed', inputTokens: 20, outputTokens: 0, units: 0, cost: 0, points: 0, createdAt: '2026-07-30T09:00:00.000Z' }),
      record({ accountId: 'account-2', accountName: '审核员', accountRole: '审核', points: 5 }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ accountName: '审核员', points: 5 })
    expect(rows[1]).toMatchObject({
      accountName: '蓝喵',
      calls: 2,
      successCalls: 1,
      failureCalls: 1,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      projectCount: 2,
      points: 2,
      lastUsedAt: '2026-07-30T09:00:00.000Z',
    })
  })

  it('keeps unknown models from different service types separate', () => {
    const rows = buildAccountModelUsageRows([
      record({ modelKey: 'unknown', modelName: '未记录模型', serviceType: 'text' }),
      record({ modelKey: 'unknown', modelName: '未记录模型', serviceType: 'image' }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.serviceType).sort()).toEqual(['image', 'text'])
  })

  it('exports Excel-compatible UTF-8 CSV and neutralizes formulas', () => {
    const rows = buildAccountModelUsageRows([
      record({ accountName: '=HYPERLINK("https://example.com")', modelName: '模型,甲\n第二行' }),
    ])
    const csv = buildAccountModelUsageCsv(rows)

    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"')
    expect(csv).toContain('"模型,甲\n第二行"')
    expect(csv).toContain('"Input Token"')
    expect(csv).toContain('"作品数"')
    expect(csv).not.toContain('"项目数"')
  })
})
