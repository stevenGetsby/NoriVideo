import React from 'react'

export function Link({ href, children, ...props }: { href: string | { pathname: string }; children?: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return <a {...props} href={typeof href === 'string' ? href : href.pathname}>{children}</a>
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
