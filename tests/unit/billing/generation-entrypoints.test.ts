import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('generation entrypoint billing coverage', () => {
  it('prices or blocks every direct generation path before provider submission', () => {
    const submitter = source('src/lib/task/submitter.ts')
    const syncBilling = source('src/lib/billing/service.ts')
    const understand = source('src/app/api/video-repaint/understand/route.ts')
    const adapt = source('src/app/api/video-repaint/adapt/route.ts')
    const enhance = source('src/app/api/video-enhance/route.ts')
    const superAgent = source('src/lib/super-agent/llm-client.ts')
    const assistant = source('src/lib/assistant-platform/runtime.ts')
    const importPipeline = source('src/lib/novel-promotion/project-import-pipeline.ts')
    const exportReview = source('src/lib/novel-promotion/export-preflight-review.ts')
    const voiceMapping = source('src/lib/novel-promotion/voice-mapping-runtime.ts')
    const taskPolicy = source('src/lib/billing/task-policy.ts')

    expect(submitter.indexOf('await requireGenerationCredit(params.userId)')).toBeLessThan(submitter.indexOf('await addTaskJob({'))
    expect(syncBilling.indexOf('await requireGenerationCredit(params.userId)')).toBeLessThan(syncBilling.indexOf('return await execute()'))
    expect(understand.indexOf('await withTextBilling(')).toBeLessThan(understand.indexOf('understandSourceStoryboardWithArk({'))
    expect(understand.lastIndexOf('await withTextBilling(')).toBeLessThan(understand.indexOf('understandVideoWithArk({'))
    expect(adapt.indexOf('await withTextBilling(')).toBeLessThan(adapt.indexOf('await runAdaptation()'))
    expect(enhance.indexOf('await requireGenerationCredit(session.user.id)')).toBeLessThan(enhance.indexOf('submitMediaKitEnhanceVideoTask(apiKey, payload)'))
    expect(enhance.indexOf('await withVideoBilling(')).toBeLessThan(enhance.indexOf('submitMediaKitEnhanceVideoTask(apiKey, payload)'))
    expect(superAgent.indexOf('await withTextBilling(')).toBeLessThan(superAgent.indexOf('runModelGatewayTextCompletion({'))
    expect(assistant.indexOf('await prepareStreamingTextBilling(')).toBeLessThan(assistant.indexOf('streamText({'))
    expect(importPipeline.indexOf('await withTextBilling(')).toBeLessThan(importPipeline.indexOf('executeAssetExtraction({'))
    expect(exportReview.indexOf('await withTextBilling(')).toBeLessThan(exportReview.indexOf('runReview,'))
    expect(voiceMapping.indexOf('await withTextBilling(')).toBeLessThan(voiceMapping.indexOf('runReview,'))
    expect(taskPolicy).toContain('taskType === TASK_TYPE.TOOLBOX_MODEL_3D')
  })
})
