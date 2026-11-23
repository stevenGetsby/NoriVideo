import React from 'react'

export function Link({ href, children, ...props }: { href: string | { pathname: string; query?: Record<string, string | number | undefined> }; children?: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const target = typeof href === 'string' ? href : `${href.pathname}${href.query && Object.keys(href.query).length ? `?${new URLSearchParams(Object.entries(href.query).flatMap(([key, value]) => value == null ? [] : [[key, String(value)]]))}` : ''}`
  return <a {...props} href={target}>{children}</a>
}
declare global { interface Window { __lmPushed?: string[]; __lmPrefetched?: string[]; __fixturePathname?: string } }
export function useRouter() {
  const record = (key: '__lmPushed' | '__lmPrefetched', href: string | { pathname: string }) => {
    const target = typeof href === 'string' ? href : href.pathname
    window[key] ||= []
    window[key]!.push(target)
  }
  return { push: (href: string | { pathname: string }) => record('__lmPushed', href), prefetch: (href: string | { pathname: string }) => record('__lmPrefetched', href), replace: () => {}, refresh: () => {}, back: () => {} }
}
export function usePathname() { return window.__fixturePathname || '/canvas' }
const emptyParams = {}
export function useParams<T extends Record<string, string | string[]> = Record<string, string>>() { return emptyParams as T }
let lastSearch = ''
let searchParams = new URLSearchParams()
export function useSearchParams() {
  if (lastSearch !== location.search) { lastSearch = location.search; searchParams = new URLSearchParams(lastSearch) }
  return searchParams
}
export function redirect() {}
