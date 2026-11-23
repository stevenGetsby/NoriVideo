import { describe, expect, it } from 'vitest'
import { boundedWindow } from '@/components/frameos/materials/material-page-client'

describe('material list windows', () => {
  it('mounts at most 96 material rows with overscan', () => {
    expect(boundedWindow(0, 10_000)).toMatchObject({ start: 0, end: 96 })
    expect(boundedWindow(4_000, 10_000)).toMatchObject({ start: 3_988, end: 4_084 })
    expect(boundedWindow(9_999, 10_000)).toMatchObject({ start: 9_904, end: 10_000 })
  })

  it('handles short and empty result sets without negative offsets', () => {
    expect(boundedWindow(0, 0)).toMatchObject({ start: 0, end: 0 })
    expect(boundedWindow(2, 3)).toMatchObject({ start: 0, end: 3 })
  })
})
