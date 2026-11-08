import React from 'react'

export function useLocale() { return 'zh' }
export function useTranslations() {
  return (key: string, values?: Record<string, unknown>) => values
    ? `${key}:${Object.entries(values).map(([field, value]) => `${field}=${String(value)}`).join(',')}`
    : key
}
export function NextIntlClientProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}
