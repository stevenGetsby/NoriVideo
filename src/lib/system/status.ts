import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { SERVER_BOOT_ID } from '@/lib/server-boot'

type PackageJson = {
  name?: string
  version?: string
  engines?: Record<string, string>
  dependencies?: Record<string, string>
}

export type SystemStatusSnapshot = {
  app: string
  version: string
  bootId: string
  node: string | null
  npm: string | null
  next: string | null
  react: string | null
  checkedAt: string
}

async function readPackageJson(): Promise<PackageJson> {
  try {
    const raw = await readFile(path.join(process.cwd(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as PackageJson : {}
  } catch {
    return {}
  }
}

export async function readSystemStatusSnapshot(): Promise<SystemStatusSnapshot> {
  const pkg = await readPackageJson()
  return {
    app: pkg.name || 'nori',
    version: pkg.version || '0.0.0',
    bootId: SERVER_BOOT_ID,
    node: pkg.engines?.node || null,
    npm: pkg.engines?.npm || null,
    next: pkg.dependencies?.next || null,
    react: pkg.dependencies?.react || null,
    checkedAt: new Date().toISOString(),
  }
}
