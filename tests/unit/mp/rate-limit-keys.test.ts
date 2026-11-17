import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/redis', () => ({ redis: {} }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))

import { MP_LOGIN_LIMIT, MP_ME_PATCH_LIMIT } from '@/lib/mp/auth'

const root = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(fullPath, out)
    else if (entry.name === 'route.ts') out.push(fullPath)
  }
  return out
}

const mpRoutes = () => walk(path.join(root, 'src', 'app', 'api', 'mp'))

describe('mp rate limit contract', () => {
  it('limits login to 20 per minute per IP', () => {
    expect(MP_LOGIN_LIMIT).toEqual({ windowSeconds: 60, maxRequests: 20 })
    const source = readFileSync(path.join(root, 'src/app/api/mp/auth/login/route.ts'), 'utf8')
    expect(source).toContain("checkRateLimit('mp:rl:login', getClientIp(request), MP_LOGIN_LIMIT)")
  })

  it('limits profile edits to 10 per hour per consumer', () => {
    expect(MP_ME_PATCH_LIMIT).toEqual({ windowSeconds: 3600, maxRequests: 10 })
    const source = readFileSync(path.join(root, 'src/app/api/mp/me/route.ts'), 'utf8')
    expect(source).toContain("checkRateLimit('mp:rl:me', auth.consumer.id, MP_ME_PATCH_LIMIT)")
  })

  it('limits search to 30 per minute per IP', () => {
    const catalog = readFileSync(path.join(root, 'src/lib/mp/catalog.ts'), 'utf8')
    expect(catalog).toContain('export const MP_SEARCH_LIMIT = { windowSeconds: 60, maxRequests: 30 }')
    const source = readFileSync(path.join(root, 'src/app/api/mp/search/route.ts'), 'utf8')
    expect(source).toContain("checkRateLimit('mp:rl:search', getClientIp(request), MP_SEARCH_LIMIT)")
  })

  it('uses the mp:rl: key prefix for every mp rate limit', () => {
    const calls: string[] = []
    for (const file of mpRoutes()) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/checkRateLimit\(\s*'([^']+)'/g)) calls.push(match[1])
    }
    expect(calls.length).toBeGreaterThan(0)
    for (const action of calls) expect(action.startsWith('mp:rl:')).toBe(true)
  })
})
