'use client'

import { createContext, useContext } from 'react'

export interface FosCanvasShellState {
  enabled: boolean
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}

const DEFAULT_STATE: FosCanvasShellState = {
  enabled: false,
  sidebarCollapsed: true,
  toggleSidebar: () => undefined,
}

export const FosCanvasShellContext = createContext<FosCanvasShellState>(DEFAULT_STATE)

export function useFosCanvasShell() {
  return useContext(FosCanvasShellContext)
}
