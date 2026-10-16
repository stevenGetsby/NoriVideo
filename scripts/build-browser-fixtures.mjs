import path from 'node:path'
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const root = process.cwd()
const names = process.argv.slice(2)
if (names.length === 0 || names.some((name) => !/^[a-z0-9-]+$/.test(name))) {
  throw new Error('Provide one or more browser fixture names.')
}
await build({
  entryPoints: Object.fromEntries(names.map((name) => [name, `tests/browser/${name}.fixture.tsx`])),
  bundle: true,
  outdir: 'test-results/material-bundles',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const globalInput = path.join(root, 'src/app/globals.css')
const globalOutput = path.join(root, 'test-results/material-bundles/global.css')
const css = await postcss([tailwindcss()]).process(await readFile(globalInput, 'utf8'), { from: globalInput, to: globalOutput, map: false })
await writeFile(globalOutput, css.css)
console.log(`Built ${names.length} real-component browser fixtures.`)
