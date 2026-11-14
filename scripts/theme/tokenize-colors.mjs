import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ramp = new Map(Object.entries({
  '08080c': ['bg', '0'], '0c0c11': ['bg', '1'], '131319': ['bg', '2'],
  '1b1b23': ['bg', '3'], '24242e': ['bg', '4'], '2f2f3b': ['bg', '5'],
  f5f5fa: ['text', '1'], bcbdcb: ['text', '2'], '9c9dae': ['text', '3'],
  '87889a': ['text', '4'], '5e5f70': ['text', '5'],
  '6e7bff': ['primary', ''], '5f6cf5': ['primary-hover', ''], a3acff: ['primary-text', ''],
}))

export function srgbToOklch(hex) {
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  const [r, g, b] = rgb
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b)
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b)
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
  const lab = [
    .2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s,
  ]
  return { l: lab[0], c: Math.hypot(lab[1], lab[2]), h: Math.atan2(lab[2], lab[1]) }
}

export function oklchToHex({ l, c, h }) {
  let chroma = c
  const a = Math.cos(h)
  const b = Math.sin(h)
  const convert = () => {
    const ll = (l + .3963377774 * a * chroma + .2158037573 * b * chroma) ** 3
    const mm = (l - .1055613458 * a * chroma - .0638541728 * b * chroma) ** 3
    const ss = (l - .0894841775 * a * chroma - 1.291485548 * b * chroma) ** 3
    return [
      4.0767416621 * ll - 3.3077115913 * mm + .2309699292 * ss,
      -1.2684380046 * ll + 2.6097574011 * mm - .3413193965 * ss,
      -.0041960863 * ll - .7034186147 * mm + 1.707614701 * ss,
    ].map((value) => 255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055))
  }
  while (convert().some((value) => value < -.5 || value > 255.5) && chroma > 0) chroma *= .95
  return convert().map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')
}

export function lightColor(hex, role) {
  const color = srgbToOklch(hex)
  if (role === 's' && color.l > .85) return hex
  if (role === 't' && color.l < .2) return hex
  color.l = role === 's' ? 1 - .35 * color.l : .12 + .86 * (1 - color.l)
  return oklchToHex(color)
}

const alphaNumber = (value) => String(Number(value))
const channel = (name, alpha) => alpha === undefined ? `rgb(var(--nori-${name}))` : `rgb(var(--nori-${name}) / ${alpha})`

export function transformCss(css, tokens = new Map()) {
  const output = []
  let cursor = 0
  const rule = /([^{}]+)\{([^{}]*)\}/g
  for (let match; (match = rule.exec(css));) {
    const [, selector, body] = match
    if (/@|nori-force-dark|nori-auth|nori-admin-login/.test(selector)) continue
    output.push(css.slice(cursor, match.index))
    let next = body
    const declarations = []
    const declaration = /(?:^|;)\s*([-a-z]+)\s*:/g
    for (let item; (item = declaration.exec(body));) declarations.push({ index: item.index, name: item[1] })
    const roleAt = (index) => {
      const found = declarations.filter((item) => item.index <= index).at(-1)
      return found && /(?:^|-)color$|text-fill-color|text-decoration-color/.test(found.name) ? 't' : 's'
    }
    next = next.replace(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)|rgb\(\s*255\s+255\s+255\s*\/\s*([\d.]+)\s*\)/gi, (_, a, b) => {
      const alpha = alphaNumber(a || b)
      return roleAt(match.index + match[0].indexOf(_)) === 't' ? channel('ink', alpha) : channel('ink', `calc(${alpha} * var(--nori-a))`)
    })
    next = next.replace(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi, (literal, raw) => {
      const expanded = raw.length <= 4 ? [...raw].map((char) => char + char).join('') : raw
      const hex = expanded.slice(0, 6).toLowerCase()
      const alpha = expanded.length === 8 ? alphaNumber(String(parseInt(expanded.slice(6), 16) / 255)) : undefined
      const entry = ramp.get(hex)
      if (entry) return channel(entry.join('-'), alpha)
      if (hex === '0d0d0d') return channel('page-bg', alpha)
      const role = roleAt(match.index + match[0].indexOf(literal))
      if (hex === 'ffffff' && role === 't') {
        const onBrand = /fos-primary|fos-danger|fos-success|#ef4444|#6e7bff|linear-gradient/.test(body)
        return onBrand ? literal : channel('text-1', alpha)
      }
      const name = `${role}-${hex}`
      tokens.set(name, { dark: hex, light: lightColor(hex, role) })
      return channel(name, alpha)
    })
    output.push(`${selector}{${next}}`)
    cursor = rule.lastIndex
  }
  output.push(css.slice(cursor))
  return output.join('')
}

export function transformTsx(source) {
  return source.replace(/(bg|text|border)-\[#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\]/gi, (literal, property, raw) => {
    const expanded = raw.length <= 4 ? [...raw].map((char) => char + char).join('') : raw
    const hex = expanded.slice(0, 6).toLowerCase()
    const alpha = expanded.length === 8 ? ` / ${alphaNumber(String(parseInt(expanded.slice(6), 16) / 255))}` : ''
    const entry = ramp.get(hex)
    if (entry) return `${property}-[${channel(entry.join('-'), alpha ? Number(alpha) : undefined)}]`
    const name = `${property === 'text' ? 't' : 's'}-${hex}`
    return `${property}-[${channel(name, alpha ? Number(alpha) : undefined)}]`
  }).replace(/(?<![\w-])text-white(?![\w-/])/g, (literal, offset) => {
    const before = source.slice(0, offset)
    const start = Math.max(before.lastIndexOf('className="'), before.lastIndexOf("className='"), before.lastIndexOf('className={`'))
    const end = source.indexOf('\n', offset)
    const context = source.slice(Math.max(0, start), end < 0 ? source.length : end)
    return /bg-\[var\(--fos-(?:primary|brand)|bg-(?:indigo|violet|red|green|emerald|amber|rose)-|bg-gradient|fos-btn-(?:primary|danger)/.test(context) ? 'text-on-brand' : literal
  })
}

export function generatedCss(tokens) {
  if (!tokens.size) return '/* Generated by scripts/theme/tokenize-colors.mjs. */\n'
  const block = (selector, key) => `${selector} {\n${[...tokens].map(([name, colors]) => `  --nori-${name}: ${colors[key].match(/../g).map((pair) => parseInt(pair, 16)).join(' ')};`).join('\n')}\n}\n`
  return `/* Generated by scripts/theme/tokenize-colors.mjs. */\n${block(':root, .nori-force-dark', 'dark')}\n${block('html[data-nori-theme="light"]', 'light')}`
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    if (/ [234]\./.test(entry.name)) return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? files(file) : file
  }))).flat()
}

async function main() {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const tokens = new Map()
  const report = []
  const sourceFiles = (await files(path.join(root, 'src'))).filter((file) => /\.(css|tsx)$/.test(file))
  for (const file of sourceFiles) {
    if (file.endsWith('theme.css') || file.endsWith('theme-generated.css')) continue
    const source = await readFile(file, 'utf8')
    const next = file.endsWith('.css') ? transformCss(source, tokens) : transformTsx(source)
    if (source === next) continue
    report.push(`${path.relative(root, file)}: ${[...source].filter((char, index) => char !== next[index]).length} characters differ`)
    if (process.argv.includes('--write')) await writeFile(file, next)
  }
  if (process.argv.includes('--write')) await writeFile(path.join(root, 'src/styles/theme-generated.css'), generatedCss(tokens))
  await mkdir(path.join(root, 'test-results/theme'), { recursive: true })
  await writeFile(path.join(root, 'test-results/theme/tokenize-report.md'), `${process.argv.includes('--write') ? 'Written' : 'Check'}\n\n${report.join('\n')}\n`)
  console.log(JSON.stringify({ files: report.length, tokens: tokens.size, write: process.argv.includes('--write') }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
