export const CREATE_PROJECT_DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusCreateProjectDialogInitial(
  preferred: HTMLElement | null,
  fallback: HTMLElement,
): HTMLElement {
  const target = preferred || fallback
  target.focus()
  return target
}

export function trapCreateProjectDialogTab(
  dialog: HTMLElement,
  activeElement: Element | null,
  backwards: boolean,
): boolean {
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(CREATE_PROJECT_DIALOG_FOCUSABLE_SELECTOR))
  if (focusable.length === 0) {
    dialog.focus()
    return true
  }

  const activeIndex = focusable.findIndex((element) => element === activeElement)
  const lastIndex = focusable.length - 1
  const target = backwards
    ? activeIndex <= 0 ? focusable[lastIndex] : null
    : activeIndex === -1 || activeIndex === lastIndex ? focusable[0] : null
  if (!target) return false
  target.focus()
  return true
}

export function restoreCreateProjectDialogFocus(target: HTMLElement | null): boolean {
  if (!target?.isConnected) return false
  target.focus()
  return true
}
