'use client'

import { usePathname } from "next/navigation"
import { SessionProvider } from "next-auth/react"
import { ToastProvider } from "@/contexts/ToastContext"
import { QueryProvider } from "@/components/providers/QueryProvider"
import { OldBrowserNotice } from "@/components/OldBrowserNotice"
import "@/lib/web-crypto-compat"

export function Providers({ children }: { children: React.ReactNode }) {
  const isAuthPage = usePathname()?.includes('/auth/')
  return (
    <SessionProvider
      // Account roles are managed from another authenticated surface. Refresh
      // the session when a staff member returns to this tab, and periodically
      // while it stays open, so role changes cannot leave permission buttons
      // stuck on the previous role until a manual reload.
      refetchOnWindowFocus={!isAuthPage}
      refetchInterval={isAuthPage ? 0 : 300}
    >
      <QueryProvider>
        <ToastProvider>
          {children}
          <OldBrowserNotice />
        </ToastProvider>
      </QueryProvider>
    </SessionProvider>
  )
}
