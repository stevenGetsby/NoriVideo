function keyPart(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim()
  return normalized ? encodeURIComponent(normalized) : fallback
}

/**
 * The workflow lives under one catch-all Next.js page. Give each logical
 * surface its own React identity so route-local overlays and canvas chrome do
 * not survive a back navigation into another panel.
 */
export function workflowNavigationSurfaceKey(
  projectId: string,
  view: string,
  focus?: string | null,
) {
  return [
    'workflow',
    keyPart(projectId, 'project'),
    keyPart(view, 'overview'),
    keyPart(focus, 'root'),
  ].join(':')
}

/**
 * The global canvas hub and every selected project also share a catch-all
 * page. Project changes must remount the shell instead of reusing the previous
 * canvas' menus, dialogs, and collapsed-sidebar state.
 */
export function canvasNavigationSurfaceKey(projectId?: string | null) {
  return `canvas:${keyPart(projectId, 'home')}`
}
