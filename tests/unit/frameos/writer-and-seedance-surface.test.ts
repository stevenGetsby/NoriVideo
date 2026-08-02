import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('writer workbench surface', () => {
  it('exposes only the video repaint creation entry without a version suffix', () => {
    const workbench = readSource('src/components/frameos/views/FosScreenwriter.tsx')
    const models = readSource('src/components/frameos/views/screenwriterModels.ts')
    const setup = readSource('src/components/frameos/views/FosVideoRepaintSetup.tsx')
    const progress = readSource('src/components/frameos/views/FosVideoRepaintProgress.tsx')

    expect(workbench).toContain('WRITER_TOOL')
    expect(models).toContain("title: '视频转绘'")
    expect(models).not.toMatch(/视频转剧本|视频转分镜|剧本转绘|分镜转绘|小说改编/)
    expect(`${models}\n${setup}\n${progress}`).not.toContain('视频转绘 2.0')
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
