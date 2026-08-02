import { describe, expect, it, vi } from 'vitest'
import {
  CREATE_PROJECT_DIALOG_FOCUSABLE_SELECTOR,
  focusCreateProjectDialogInitial,
  restoreCreateProjectDialogFocus,
  trapCreateProjectDialogTab,
} from '@/components/frameos/works/create-project-dialog-focus'

function element(connected = true) {
  return {
    focus: vi.fn(),
    isConnected: connected,
  } as unknown as HTMLElement
}

function dialogWith(focusable: HTMLElement[]) {
  return {
    focus: vi.fn(),
    isConnected: true,
    querySelectorAll: vi.fn(() => focusable),
  } as unknown as HTMLElement
}

describe('Works create-project dialog focus behavior', () => {
  it('focuses the project-name field first and falls back to the dialog', () => {
    const dialog = dialogWith([])
    const projectName = element()

    expect(focusCreateProjectDialogInitial(projectName, dialog)).toBe(projectName)
    expect(projectName.focus).toHaveBeenCalledOnce()
    expect(dialog.focus).not.toHaveBeenCalled()

    expect(focusCreateProjectDialogInitial(null, dialog)).toBe(dialog)
    expect(dialog.focus).toHaveBeenCalledOnce()
  })

  it('wraps Tab and Shift+Tab at the dialog boundaries', () => {
    const close = element()
    const projectName = element()
    const submit = element()
    const dialog = dialogWith([close, projectName, submit])

    expect(trapCreateProjectDialogTab(dialog, submit, false)).toBe(true)
    expect(close.focus).toHaveBeenCalledOnce()

    expect(trapCreateProjectDialogTab(dialog, close, true)).toBe(true)
    expect(submit.focus).toHaveBeenCalledOnce()

    expect(trapCreateProjectDialogTab(dialog, projectName, false)).toBe(false)
    expect(projectName.focus).not.toHaveBeenCalled()
    expect(dialog.querySelectorAll).toHaveBeenCalledWith(CREATE_PROJECT_DIALOG_FOCUSABLE_SELECTOR)
  })

  it('recaptures escaped focus and keeps an all-disabled busy dialog contained', () => {
    const first = element()
    const last = element()
    const outside = element()
    const dialog = dialogWith([first, last])

    expect(trapCreateProjectDialogTab(dialog, outside, false)).toBe(true)
    expect(first.focus).toHaveBeenCalledOnce()
    expect(trapCreateProjectDialogTab(dialog, outside, true)).toBe(true)
    expect(last.focus).toHaveBeenCalledOnce()

    const busyDialog = dialogWith([])
    expect(trapCreateProjectDialogTab(busyDialog, outside, false)).toBe(true)
    expect(busyDialog.focus).toHaveBeenCalledOnce()
  })

  it('restores only a trigger that is still connected', () => {
    const trigger = element()
    const removedTrigger = element(false)

    expect(restoreCreateProjectDialogFocus(trigger)).toBe(true)
    expect(trigger.focus).toHaveBeenCalledOnce()
    expect(restoreCreateProjectDialogFocus(removedTrigger)).toBe(false)
    expect(removedTrigger.focus).not.toHaveBeenCalled()
    expect(restoreCreateProjectDialogFocus(null)).toBe(false)
  })
})
