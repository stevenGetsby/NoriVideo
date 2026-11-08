import React from 'react'

export function Link({ href, children, ...props }: { href: string | { pathname: string; query?: Record<string, string | number | undefined> }; children?: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const target = typeof href === 'string' ? href : `${href.pathname}${href.query && Object.keys(href.query).length ? `?${new URLSearchParams(Object.entries(href.query).flatMap(([key, value]) => value == null ? [] : [[key, String(value)]]))}` : ''}`
  return <a {...props} href={target}>{children}</a>
}
export function useRouter() { return { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} } }
export function usePathname() { return '/canvas' }
let lastSearch = ''
let searchParams = new URLSearchParams()
export function useSearchParams() {
  if (lastSearch !== location.search) { lastSearch = location.search; searchParams = new URLSearchParams(lastSearch) }
  return searchParams
}
export function redirect() {}
