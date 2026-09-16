import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { TosStorageProvider } from '@/lib/storage/providers/tos'

// Never log provider errors or signed URLs: either can contain credential data.
async function main() {
  const runtimeGuard = resolve('fixed-tos-config-guard.mjs')
  const guard = existsSync(runtimeGuard)
    ? runtimeGuard
    : resolve('scripts/guards/fixed-tos-config-guard.mjs')
  execFileSync(process.execPath, [guard, ...(process.env.NORI_SERVICE_CONFIG ? ['--runtime'] : [])], {
    stdio: 'inherit',
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, init) => originalFetch(input, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  })
  const provider = new TosStorageProvider()
  const key = `healthchecks/deploy/${randomUUID()}.txt`
  const body = Buffer.from(`NoriVideo fixed TOS deployment probe ${randomUUID()}`)
  let stage = 'upload'
  try {
    await provider.uploadObject({ key, body, contentType: 'text/plain' })
    stage = 'read'
    if (!(await provider.getObjectBuffer(key)).equals(body)) throw new Error('READ_MISMATCH')
    stage = 'signed-read'
    const signedUrl = await provider.getSignedObjectUrl({ key, expiresInSeconds: 60 })
    const response = await fetch(signedUrl)
    if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(body)) throw new Error('SIGNED_READ_FAILED')
  } catch {
    console.error(`[fixed-tos-probe] failed at ${stage}; details withheld to protect credentials`)
    process.exitCode = 1
  } finally {
    // This exact random object belongs to this probe; never delete a prefix or existing data.
    try {
      await provider.deleteObject(key)
      console.log('[fixed-tos-probe] temporary probe object deleted')
    } catch {
      console.error(`[fixed-tos-probe] cleanup failed; remove only this probe object: ${key}`)
      process.exitCode = 1
    }
    globalThis.fetch = originalFetch
  }
  if (!process.exitCode) console.log('[fixed-tos-probe] upload/read/signed-read/delete passed')
}

void main().catch(() => {
  console.error('[fixed-tos-probe] preflight failed; credentials were not printed')
  process.exitCode = 1
})
