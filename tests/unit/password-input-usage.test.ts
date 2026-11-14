import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.join(process.cwd(), 'src')
const allowed = new Set([
  'app/[locale]/auth/signin/page.tsx',
  'app/[locale]/auth/change-password/page.tsx',
])

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (/ [2-9]\./.test(entry.name)) return []
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? tsxFiles(absolute) : absolute.endsWith('.tsx') ? [absolute] : []
  })
}

describe('PasswordInput usage', () => {
  it('keeps raw password inputs limited to components with an explicit visibility control', () => {
    const failures = tsxFiles(sourceRoot).filter((file) => {
      const relative = path.relative(sourceRoot, file)
      return !allowed.has(relative) && /type=["']password["']/.test(readFileSync(file, 'utf8'))
    })
    expect(failures.map((file) => path.relative(sourceRoot, file))).toEqual([])
  })
})
