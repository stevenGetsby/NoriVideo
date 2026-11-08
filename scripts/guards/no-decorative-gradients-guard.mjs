#!/usr/bin/env node

/**
 * 纯色 UI 守卫：禁止在自有 UI 源码中重新引入装饰性 CSS/SVG 渐变。
 *
 * 功能性渐变（时间轴刻度线、数据可视化圆环）与其它工作流负责的文件
 * 通过下方白名单显式豁免；白名单中的残留项已在任务报告中交接给主 agent。
 */

import fs from 'fs'
import path from 'path'
import url from 'url'
import process from 'process'

const root = process.cwd()
const scanRoot = path.join(root, 'src')
const sourceExtensions = new Set(['.css', '.ts', '.tsx', '.js', '.jsx'])
const gradientPattern = /(?:repeating-)?(?:linear|radial|conic)-gradient\(|<linearGradient\b|\bbg-(?:gradient|linear|radial|conic)\b/

function toRel(fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/')
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, out)
      continue
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      out.push(fullPath)
    }
  }
  return out
}

/** 整体豁免：仅用于开发预览的页面。 */
const excludedFiles = new Map([
  ['src/app/[locale]/dev/segmented-control-test/page.tsx', '仅开发预览页'],
  ['src/app/[locale]/dev/workspace-redesign/VariantClearBreath.tsx', '仅开发预览页'],
  ['src/app/[locale]/dev/workspace-redesign/ProjectLayouts.tsx', '仅开发预览页'],
])

/** 行级豁免：功能性渐变，不属于装饰。 */
const functionalLinePatterns = [
  {
    file: 'src/features/canvas/canvas.css',
    pattern: /input\[type="range"\].*|var\(--nori-video-progress/,
    reason: 'range 已填充区间表示实际进度',
  },
  {
    file: 'src/features/canvas/canvas.css',
    pattern: /\.nori-video-timeline-clip\.is-unavailable|\.nori-video-timeline-wave\.is-silent|\.nori-playlist-ruler::after/,
    reason: '媒体失效/静音状态和标尺刻度为功能提示',
  },
  {
    file: 'src/styles/frameos-replica.css',
    pattern: /repeating-linear-gradient\(/,
    reason: '时间轴/标尺刻度线为功能背景',
  },
  {
    file: 'src/components/workspace/FrameServiceRecordsDashboard.tsx',
    pattern: /conic-gradient\(/,
    reason: '用量圆环为数据可视化',
  },
]

export function inspectDecorativeGradients() {
  const violations = []
  for (const fullPath of walk(scanRoot)) {
    const rel = toRel(fullPath)
    if (excludedFiles.has(rel)) continue

    const text = fs.readFileSync(fullPath, 'utf8')
    if (!gradientPattern.test(text)) continue

    const lines = text.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!gradientPattern.test(line)) return
      const excused = functionalLinePatterns.some(
        (entry) => entry.file === rel && entry.pattern.test(line),
      )
      if (excused) return
      violations.push(`${rel}:${index + 1}: ${line.trim().slice(0, 160)}`)
    })
  }
  return { violations, excludedFiles, functionalLinePatterns }
}

function main() {
  const { violations } = inspectDecorativeGradients()
  if (violations.length > 0) {
    console.error('\n[no-decorative-gradients] 发现装饰性渐变，请改用纯色 token：')
    for (const violation of violations) {
      console.error(`  - ${violation}`)
    }
    process.exit(1)
  }
  console.log('[no-decorative-gradients] OK — 自有 UI 源码无装饰性渐变')
}

if (process.argv[1] && import.meta.url === url.pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
