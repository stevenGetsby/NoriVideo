import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StoryImageField } from '@/features/canvas/story/StoryImageField'

// Vitest's esbuild transform emits classic JSX; the component only touches this at render time.
;(globalThis as typeof globalThis & { React?: typeof React }).React = React

const render = (props: Parameters<typeof StoryImageField>[0]) => renderToStaticMarkup(createElement(StoryImageField, props))

describe('story image field', () => {
  it('renders upload with the story asset accept list', () => {
    const html = render({ label: '按钮图片', value: null, workId: 'work-1', readOnly: false, onChange: () => {} })
    expect(html).toContain('accept="image/png,image/jpeg,image/webp,image/gif"')
    expect(html).toContain('上传')
    expect(html).not.toContain('<img')
  })

  it('shows the picture with a remove action', () => {
    const html = render({ label: '道具图片', value: '/uploads/prop.png', workId: 'work-1', readOnly: false, onChange: () => {} })
    expect(html).toContain('src="/uploads/prop.png"')
    expect(html).toContain('移除')
    expect(html).toContain('更换')
  })

  it('disables uploading without a work and hides edit affordances when read-only', () => {
    const noWork = render({ label: '按钮图片', value: null, workId: null, readOnly: false, onChange: () => {} })
    expect(noWork).toContain('disabled=""')
    const readOnly = render({ label: '按钮图片', value: '/uploads/prop.png', workId: 'work-1', readOnly: true, onChange: () => {} })
    expect(readOnly).not.toContain('移除')
  })

  it('renders the compact variant as an icon button', () => {
    const html = render({ label: '选项图片', value: null, workId: 'work-1', readOnly: false, compact: true, onChange: () => {} })
    expect(html).toContain('nori-story-image-button')
    expect(html).toContain('aria-label="选项图片：上传"')
  })
})
