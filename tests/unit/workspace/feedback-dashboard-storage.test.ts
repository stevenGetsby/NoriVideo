import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('FrameFeedbackDashboard storage boundary', () => {
  it('does not persist submitted feedback records in browser localStorage', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/workspace/FrameFeedbackDashboard.tsx'),
      'utf8',
    )

    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('nori.frameos.feedback.records')
    expect(source).toContain("apiFetch('/api/feedback'")
  })
})
