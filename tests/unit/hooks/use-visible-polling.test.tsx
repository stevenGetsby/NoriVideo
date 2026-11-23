// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisiblePolling } from '@/hooks/common/useVisiblePolling'

describe('useVisiblePolling', () => {
  let root: Root
  let container: HTMLDivElement
  let callback: () => void | Promise<void>

  function mount(intervalMs: number | null) {
    act(() => {
      root.render(<Hook callback={callback} intervalMs={intervalMs} />)
    })
  }

  function Hook({ callback, intervalMs }: { callback: () => void | Promise<void>; intervalMs: number | null }) {
    useVisiblePolling(callback, intervalMs)
    return null
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('does not run when disabled and uses the requested interval', async () => {
    callback = vi.fn()
    mount(null)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(callback).not.toHaveBeenCalled()

    mount(3_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(callback).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(callback).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('pauses while hidden and refreshes immediately when visible', async () => {
    callback = vi.fn()
    mount(3_000)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await vi.advanceTimersByTimeAsync(9_000)
    expect(callback).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await vi.advanceTimersByTimeAsync(0)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('does not overlap requests and follows the latest callback without restarting', async () => {
    let finish = () => {}
    const first = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    callback = first
    mount(3_000)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(first).toHaveBeenCalledTimes(1)
    const second = vi.fn()
    callback = second
    act(() => {
      root.render(<Hook callback={callback} intervalMs={3_000} />)
    })
    expect(second).not.toHaveBeenCalled()
    finish()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
