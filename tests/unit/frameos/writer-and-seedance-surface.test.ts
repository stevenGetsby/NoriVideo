import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('writer workbench surface', () => {
  it('keeps the script workbench and identifies video repaint as retired', () => {
    const workbench = readSource('src/components/frameos/views/FosScreenwriter.tsx')
    const models = readSource('src/components/frameos/views/screenwriterModels.ts')
    const client = readSource('src/components/frameos/FosVideoRepaintClient.tsx')

    expect(workbench).toContain('WRITER_TOOL')
    expect(workbench).toContain('视频转绘已停用')
    expect(models).toContain("title: '视频转绘'")
    expect(client).toContain('已有剧本不受影响')
    expect(client).not.toContain('视频转绘 2.0')
  })
})

describe('Seedance HOT panel removal', () => {
  it('has no navigation, toolbox tab, standalone page, or dashboard implementation', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const legacyShell = readSource('src/components/workspace/FrameWorkbenchShell.tsx')
    const toolbox = readSource('src/components/frameos/views/FosToolbox.tsx')

    expect(`${shell}\n${legacyShell}`).not.toContain("href: '/seedance'")
    expect(toolbox).not.toContain('SeedancePanel')
    expect(toolbox).not.toContain("'seedance'")
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/[locale]/seedance/page.tsx'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'src/components/workspace/FrameSeedanceDashboard.tsx'))).toBe(false)
  })
})
