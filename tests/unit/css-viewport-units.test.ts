import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.join(process.cwd(), 'src')
function filesUnder(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (/ [2-9]\./.test(entry.name)) return []
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(absolute, extension) : absolute.endsWith(extension) ? [absolute] : []
  })
}

describe('viewport unit fallbacks', () => {
  it('keeps a static viewport fallback immediately before each dynamic viewport declaration', () => {
    const failures: string[] = []
    for (const file of filesUnder(sourceRoot, '.css')) {
      const root = postcss.parse(readFileSync(file, 'utf8'))
      root.walkDecls(/\d(?:dvh|svh|lvh)\b/, (declaration) => {
        const previous = declaration.prev()
        if (previous?.type !== 'decl' || previous.prop !== declaration.prop || !/\dvh\b/.test(previous.value)) {
          failures.push(`${path.relative(sourceRoot, file)}: ${declaration.prop}: ${declaration.value}`)
        }
      })
    }
    expect(failures).toEqual([])
  })

  it('does not put dynamic viewport units in inline styles', () => {
    const failures = filesUnder(sourceRoot, '.tsx').flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(/style=\{\{[\s\S]*?\}\}/g)]
        .filter(([style]) => /\d(?:dvh|svh|lvh)\b/.test(style))
        .map(() => path.relative(sourceRoot, file))
    })
    expect(failures).toEqual([])
  })
})
