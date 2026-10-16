// Local-only visual preview. Authentication is simulated; no real account
// service, credentials storage, production database, or generation API is used.
import path from 'node:path'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const root = process.cwd()
export async function createAuthPreview({ port = 0 } = {}) {
  const output = path.join(root, 'test-results/auth-redesign')
  await mkdir(output, { recursive: true })
  const bundle = await build({
    entryPoints: ['tests/browser/auth-home.fixture.tsx'], bundle: true, write: false,
    outdir: '/auth-preview', jsx: 'automatic', platform: 'browser',
    alias: {
      '@': path.join(root, 'src'),
      '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
      'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
      'next-auth/react': path.join(root, 'tests/browser/stubs/auth-signin.ts'),
      'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
    },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  })
  const input = path.join(root, 'src/app/globals.css')
  const css = (await postcss([tailwindcss()]).process(await readFile(input, 'utf8'), { from: input, map: false })).css
  const image = await readFile(path.join(root, 'public/auth/cinematic-landscape.webp'))
  const brandImages = new Map(await Promise.all(['lanmiao-cat.png', 'lanmiao-cat-icon.png', 'lanmiao-cat-apple.png'].map(async (name) => [
    `/brand/${name}`, await readFile(path.join(root, 'public/brand', name)),
  ])))
  const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const pathname = new URL(req.url || '/', 'http://localhost').pathname
    if (brandImages.has(pathname)) {
      res.setHeader('Content-Type', 'image/png'); return res.end(brandImages.get(pathname))
    }
    if (req.url?.startsWith('/auth/cinematic-landscape.webp')) {
      res.setHeader('Content-Type', 'image/webp'); return res.end(image)
    }
    if (req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript'); return res.end(script)
    }
    if (req.url === '/global.css') {
      res.setHeader('Content-Type', 'text/css'); return res.end(css)
    }
    if (req.url?.startsWith('/__fixture/auth/')) {
      res.setHeader('Content-Type', 'application/json')
      return res.end(req.url.endsWith('/session') ? 'null' : JSON.stringify({ ok: false, status: 401, error: 'CredentialsSignin' }))
    }
    if (/\/(?:works|admin\/accounts)$/.test(req.url || '')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.end('<!doctype html><html lang="zh"><h1>登录跳转验证完成</h1><p>这是独立界面预览，不连接业务账号。</p></html>')
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NoriVideo — 登录首页设计预览</title><link rel="icon" type="image/png" href="/brand/lanmiao-cat-icon.png?v=4"><link rel="stylesheet" href="/global.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}
if (process.argv.includes('--serve')) {
  const port = Number(process.env.NORI_AUTH_PREVIEW_PORT || 4318)
  const { base } = await createAuthPreview({ port })
  console.log(`Local design preview: ${base} (UI only; authentication is simulated)`)
}
