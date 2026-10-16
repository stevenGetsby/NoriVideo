import { afterEach, describe, expect, it, vi } from 'vitest'
const registerMock = vi.hoisted(() => vi.fn())
vi.mock('@/instrumentation-runtime', () => ({ registerProductionInstrumentation: registerMock }))
import { register } from '@/instrumentation'

describe('web-only/admin startup does not replay active generation jobs', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
  it.each([
    ['admin', 'all'],
    ['workspace', 'web'],
  ])('skips worker recovery for %s/%s', async (surface, mode) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('NORI_APP_SURFACE', surface)
    vi.stubEnv('SERVICE_MODE', mode)
    await register()
    expect(registerMock).not.toHaveBeenCalled()
  })
  it('retains task recovery for the production worker-owning workspace service', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('NORI_APP_SURFACE', 'workspace')
    vi.stubEnv('SERVICE_MODE', 'all')
    await register()
    expect(registerMock).toHaveBeenCalledOnce()
  })
  it('does not run production recovery during local development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    await register()
    expect(registerMock).not.toHaveBeenCalled()
  })
})
