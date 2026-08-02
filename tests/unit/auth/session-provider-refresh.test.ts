import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('account session refresh', () => {
  it('refreshes changed staff roles without requiring a manual page reload', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/[locale]/providers.tsx'),
      'utf8',
    )

    expect(source).toContain('refetchOnWindowFocus')
    expect(source).toContain('refetchInterval={30}')
    expect(source).not.toContain('refetchOnWindowFocus={false}')
    expect(source).not.toContain('refetchInterval={0}')
  })
})
