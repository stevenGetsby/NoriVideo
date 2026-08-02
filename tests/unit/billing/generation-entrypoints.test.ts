import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('generation entrypoint credit gate', () => {
  it('gates queued, synchronous, video repaint, and MediaKit generation before provider submission', () => {
    const submitter = source('src/lib/task/submitter.ts')
    const syncBilling = source('src/lib/billing/service.ts')
    const understand = source('src/app/api/video-repaint/understand/route.ts')
    const adapt = source('src/app/api/video-repaint/adapt/route.ts')
    const enhance = source('src/app/api/video-enhance/route.ts')

    expect(submitter.indexOf('await requireGenerationCredit(params.userId)')).toBeLessThan(submitter.indexOf('await addTaskJob({'))
    expect(syncBilling.indexOf('await requireGenerationCredit(params.userId)')).toBeLessThan(syncBilling.indexOf('return await execute()'))
    expect(understand.indexOf('await requireGenerationCredit(authResult.session.user.id)')).toBeLessThan(understand.indexOf('understandVideoWithArk({'))
    expect(adapt.indexOf('await requireGenerationCredit(authResult.session.user.id)')).toBeLessThan(adapt.indexOf('adaptVideoScriptWithArk({'))
    expect(enhance.indexOf('await requireGenerationCredit(session.user.id)')).toBeLessThan(enhance.indexOf('submitMediaKitEnhanceVideoTask(apiKey, payload)'))
  })
})
