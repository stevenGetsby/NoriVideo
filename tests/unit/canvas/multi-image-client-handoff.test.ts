import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('canvas multi-image client handoff', () => {
  it('flushes every generation before optimistic state and never autosaves an unbound task placeholder', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'),
      'utf8',
    )
    const start = source.indexOf('const handleGenerate = useCallback')
    const end = source.indexOf('const materializeStoryboardPlan = useCallback', start)
    const handleGenerate = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(handleGenerate.indexOf('await prepareGenerationSubmission()'))
      .toBeLessThan(handleGenerate.indexOf("record('提交生成')"))
    const optimisticStart = handleGenerate.indexOf('setNodes((current) => current.map((node) => node.id === target.id')
    const textBranch = handleGenerate.indexOf("if (request.type === 'text')", optimisticStart)
    expect(optimisticStart).toBeGreaterThan(-1)
    expect(handleGenerate.slice(optimisticStart, textBranch)).not.toContain('markChanged(')
    expect(handleGenerate).toContain('if (request.storyboard || multiImageRevision)')
    expect(handleGenerate).toContain('const restoreAuthoritativeTarget = async () =>')
    expect(handleGenerate).toContain('await restoreAuthoritativeTarget()')
    expect(handleGenerate).toContain('await loadAutosaveServerVersion()')
    expect(handleGenerate).not.toContain('mergeAutosaveServerVersion')
  })

  it('assigns a fresh idempotency key to non-canvas toolbox submissions', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/frameos/views/FosToolbox.tsx'),
      'utf8',
    )
    const endpoint = source.indexOf("apiFetch('/api/frameos/toolbox/generate'")
    const submission = source.slice(endpoint, source.indexOf("if (!response.ok)", endpoint))

    expect(endpoint).toBeGreaterThanOrEqual(0)
    expect(submission).toContain('count: activeType === \'image\' ? Number(count) : 1')
    expect(submission).toContain('idempotencyKey: crypto.randomUUID()')
  })
})
