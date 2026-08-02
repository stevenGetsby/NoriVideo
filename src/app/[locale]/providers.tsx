'use client'

import { SessionProvider } from "next-auth/react"
import { ToastProvider } from "@/contexts/ToastContext"
import { QueryProvider } from "@/components/providers/QueryProvider"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // Account roles are managed from another authenticated surface. Refresh
      // the session when a staff member returns to this tab, and periodically
      // while it stays open, so role changes cannot leave permission buttons
      // stuck on the previous role until a manual reload.
      refetchOnWindowFocus
      refetchInterval={30}
    >
      <QueryProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </QueryProvider>
    </SessionProvider>
  )
}
