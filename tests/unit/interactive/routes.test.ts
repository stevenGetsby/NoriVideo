import { describe, expect, it } from 'vitest'
import { chapterHref } from '@/lib/interactive/routes'

describe('story chapter routes', () => {
  it('builds the dedicated chapter editor URL and optionally targets one canvas', () => {
    expect(chapterHref('work-1', 'project-1')).toBe('/interactive/work-1/chapters/project-1')
    expect(chapterHref('work-1', 'project-1', 'canvas-1')).toBe('/interactive/work-1/chapters/project-1/canvas-1')
    expect(chapterHref('work-1', 'project-1', null)).toBe('/interactive/work-1/chapters/project-1')
  })

  it('encodes ids so a name-like segment cannot change the route shape', () => {
    expect(chapterHref('work/一', 'project 1', 'canvas?x=1')).toBe(
      '/interactive/work%2F%E4%B8%80/chapters/project%201/canvas%3Fx%3D1',
    )
  })
})
