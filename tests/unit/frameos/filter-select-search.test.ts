import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('searchable filter select', () => {
  const select = readSource('src/components/frameos/FosFilterSelect.tsx')

  it('filters options with the shared fuzzy matcher while the user types', () => {
    expect(select).toContain("import { filterByFuzzyQuery } from '@/lib/frameos/fuzzy-match'")
    expect(select).toContain('filterByFuzzyQuery(options, appliedQuery)')
    expect(select).toContain('没有匹配')
  })

  it('does not select an option or filter on half-typed pinyin during IME composition', () => {
    expect(select).toContain('event.nativeEvent.isComposing || event.keyCode === 229')
    expect(select).toContain('onCompositionEnd={(event) => updateQuery(event.currentTarget.value)}')
    expect(select).toContain('(event.nativeEvent as InputEvent).isComposing')
  })

  it('keeps the active option visible and lets required fields hide the clear button', () => {
    expect(select).toContain('list.scrollTop = option.offsetTop')
    expect(select).toContain('allowClear && selected && !open')
    expect(select).toContain('allowClear && !open && value')
  })
})

describe('searchable filters on the toolbox and usage report', () => {
  it('uses the searchable select for toolbox function and owner work without a clear button', () => {
    const toolbox = readSource('src/components/frameos/views/FosToolbox.tsx')
    expect(toolbox).toContain("import { FosFilterSelect } from '../FosFilterSelect'")
    expect(toolbox).toContain('ariaLabel="工具箱功能"')
    expect(toolbox).toContain('ariaLabel="归属作品"')
    expect(toolbox.match(/allowClear=\{false\}/g)).toHaveLength(2)
    expect(toolbox).not.toContain('<select aria-label="归属作品"')
    expect(toolbox).not.toContain('<select aria-label="工具箱功能"')
  })

  it('searches project, work, account, service and model filters in the usage report', () => {
    const report = readSource('src/components/workspace/FrameServiceRecordsDashboard.tsx')
    for (const [label, all] of [['项目', '全部项目'], ['作品', '全部作品'], ['账号', '全部账号'], ['服务', '全部服务'], ['模型', '全部模型']]) {
      expect(report).toContain(`<ReportFilter label="${label}" allLabel="${all}"`)
    }
    expect(report).toContain('searchable = true')
    expect(report).toContain("value={value === 'all' ? '' : value}")
    expect(report).toContain("onChange={(next) => onChange(next || 'all')}")
    expect(report).not.toContain('<option value="all">全部项目</option>')
  })

  it('keeps the assignments page on the same component', () => {
    const client = readSource('src/components/frameos/FosAssignmentsClient.tsx')
    expect(client.match(/<AssignmentFilterSelect/g)?.length).toBeGreaterThanOrEqual(2)
    expect(client).toContain('searchable')
  })
})
