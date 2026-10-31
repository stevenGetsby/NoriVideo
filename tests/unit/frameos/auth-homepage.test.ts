import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import zh from '../../../messages/zh/auth.json'
import en from '../../../messages/en/auth.json'

const source = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')

describe('public creator login homepage contracts', () => {
  it('keeps workspace authentication and role-specific redirects intact', () => {
    const page = source('src/app/[locale]/auth/signin/page.tsx')
    expect(page).toContain("signIn('credentials'")
    expect(page).toContain('username: username.trim()')
    expect(page).toContain('redirect: false')
    expect(page).toContain('SURFACE_LOGIN_ERRORS.adminRequired')
    expect(page).toContain("session?.user?.role === 'super_admin'")
    expect(page).toContain('`/${locale}/admin/accounts`')
    expect(page).toContain('`/${locale}/works`')
    expect(page).toContain("pathname: '/admin/signin'")
  })
  it('guards simultaneous submissions and preserves password-manager semantics', () => {
    const page = source('src/app/[locale]/auth/signin/page.tsx')
    expect(page).toContain('if (submitting.current) return')
    expect(page).toContain('submitting.current = false')
    expect(page).toContain('autoComplete="username"')
    expect(page).toContain('autoComplete="current-password"')
    expect(page).not.toContain('password.trim()')
    expect(page).toContain('role="alert"')
    expect(page).toContain("getModifierState('CapsLock')")
  })
  it('does not inherit the fixed/zoomed workspace shell', () => {
    const shell = source('src/components/frameos/FosAuthShell.tsx')
    expect(shell).toContain('className="nori-auth"')
    expect(shell).not.toContain('className="fos-app')
    const css = source('src/styles/nori-auth.css')
    expect(css).toContain('min-height: 100dvh')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).not.toContain('position: fixed')
  })
  it('uses the local Three.js creative scene without adding tracking or mock customer metrics', () => {
    const shell = source('src/components/frameos/FosAuthShell.tsx')
    expect(shell).toContain('<AuthCreativeScene />')
    expect(shell).not.toMatch(/src="https?:\/\//)
    const scene = source('src/components/frameos/auth/AuthCreativeScene.tsx')
    expect(scene).toContain("await import('three')")
  })
  it('keeps self-registration closed and help keyboard accessible', () => {
    const signup = source('src/app/[locale]/auth/signup/page.tsx')
    expect(signup).not.toContain('<form')
    expect(signup).toContain('LanMiaoTV 不开放自行注册')
    const guide = source('src/components/frameos/auth/AuthHelpButton.tsx')
    expect(guide).toContain('element.showModal()')
    expect(guide).toContain('onCancel=')
    expect(guide).toContain('aria-labelledby={titleId}')
    expect(guide).toContain('功能区权限')
  })
  it('uses account-based error messages in both locales', () => {
    expect(zh.loginFailed).toContain('账号')
    expect(zh.loginFailed).not.toContain('手机号')
    expect(en.loginFailed).toContain('account')
    expect(en.loginFailed).not.toContain('phone number')
  })
  it('reuses the functional workspace palette instead of introducing an olive theme', () => {
    const css = source('src/styles/nori-auth.css')
    expect(css).toContain('--auth-bg: var(--fos-bg-1)')
    expect(css).toContain('--auth-panel: var(--fos-bg-2)')
    expect(css).toContain('--auth-accent: var(--fos-primary)')
    expect(css).not.toMatch(/#(?:0c0f0e|131715|e4e8ce|e2e7c8|191e1a|171e16)/i)
    expect(source('src/styles/frameos-replica.css')).toMatch(/\.fos-app,\s+\.fos-viewport-theme,\s+\.nori-auth,\s+\.nori-admin,\s+\.nori-admin-login\s*\{/)
    expect(source('src/components/frameos/FosAuthShell.tsx')).toContain('<NoriBrandMark')
  })
})
