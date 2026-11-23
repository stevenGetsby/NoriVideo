import { createRequire } from 'node:module'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
tools('playwright-core')
const artifacts = path.join(root, 'test-results/canvas-editing-theme/E3')
await mkdir(artifacts, { recursive: true })
const script = `(() => {
  const parse = (value) => {
    const match = value.match(/rgba?\\(\\s*([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+))?\\s*\\)/)
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null
  }
  const composite = (top, bottom) => [0, 1, 2].map((index) => top[index] * top[3] + bottom[index] * (1 - top[3])).concat(1)
  const luminance = (color) => {
    const linear = color.slice(0, 3).map((value) => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 })
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
  }
  const contrast = (a, b) => { const l1 = luminance(a); const l2 = luminance(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05) }
  const label = (element) => (element.getAttribute('data-testid') || element.id || element.className || element.tagName).toString().split(' ').slice(0, 3).join('.').slice(0, 100)
  const background = (element) => {
    let result = [255, 255, 255, 1]
    const layers = []
    for (let current = element; current instanceof Element; current = current.parentElement) {
      const color = parse(getComputedStyle(current).backgroundColor)
      if (color && color[3] > 0) layers.push(color)
      if (color && color[3] === 1) break
    }
    for (const layer of layers.reverse()) result = composite(layer, result)
    return result
  }
  const results = []
  const seen = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node; (node = walker.nextNode());) {
    if (!node.textContent.trim()) continue
    const element = node.parentElement
    if (!element || element.closest('svg, script, style, [aria-hidden="true"]')) continue
    if (element.closest('.nori-force-dark, .work-cover, .material-picker-card-media')) continue
    if (element.matches('textarea.mention-prompt-textarea--highlighted')) continue
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 || style.clipPath === 'inset(50%)' || !rect.width || !rect.height || rect.width <= 1 && rect.height <= 1 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue
    if (element.closest(':disabled')) continue
    const color = parse(style.color)
    if (!color) continue
    const bg = background(element)
    if (color[3] < 1 && !element.hasAttribute('style')) {
      for (let current = element.parentElement; current instanceof Element; current = current.parentElement) {
        const inherited = parse(getComputedStyle(current).color)
        if (inherited && inherited[3] === 1) {
          color[0] = inherited[0]; color[1] = inherited[1]; color[2] = inherited[2]
          break
        }
      }
    }
    const fg = composite(color, bg)
    const ratio = contrast(fg, bg)
    const size = Number.parseFloat(style.fontSize)
    const required = size >= 24 || size >= 18.66 && Number(style.fontWeight) >= 700 ? 3 : 4.5
    const key = label(element) + '|' + node.textContent.trim().slice(0, 45)
    if (seen.has(key)) continue
    seen.add(key)
    if (ratio < required) results.push({ element: label(element), text: node.textContent.trim().slice(0, 45), ratio: Math.round(ratio * 100) / 100, required, size, color: style.color, background: bg.slice(0, 3).map(Math.round).join(' '), forcedDark: Boolean(element.closest('.nori-force-dark')) })
  }
  return results
})()`
const names = process.env.VIEWS?.split(',') || ['works', 'material', 'asset-hub', 'toolbox', 'accounts', 'assignments', 'screenwriter', 'canvas-hub', 'wf-overview', 'wf-script', 'wf-assets', 'wf-timbre', 'wf-storyboard', 'wf-production', 'wf-shot', 'wf-timeline', 'repaint', 'create-project', 'updates', 'feedback', 'prompts', 'records', 'profile', 'enhance', 'canvas', 'canvas-empty', 'canvas-50', 'account-settings', 'admin-signin', 'admin-accounts', 'admin-services', 'ix-hub', 'ix-overview', 'ix-chapter', 'solid-fields', 'login']
process.env.INIT_JS = "document.documentElement.dataset.noriTheme='light';document.documentElement.dataset.noriThemePref='light'"
process.env.NORI_GALLERY_OUTPUT = path.resolve(process.env.NORI_GALLERY_OUTPUT || path.join(artifacts, 'light-current'))
process.env.CONTRAST_JS = script
if (!process.env.INTERACT) process.env.INTERACT = path.resolve('test-results/gallery/theme-interactions.mjs')
process.env.THEME_VIEWS = names.join(',')
const gallery = await import('../../test-results/gallery/shoot.mjs')
await writeFile(path.join(artifacts, 'contrast.json'), JSON.stringify(gallery.contrast, null, 2))
const items = Object.values(gallery.contrast).flat()
const summary = { pages: Object.keys(gallery.contrast).length, below3: items.filter((item) => item.ratio < 3 && !item.forcedDark).length, below45: items.filter((item) => item.ratio < 4.5 && !item.forcedDark).length, artifacts }
await writeFile(path.join(artifacts, 'contrast-summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary))
if (summary.below3) process.exitCode = 1
