import esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['../src/lib/mp/runtime-entry.ts'], bundle: true, format: 'cjs', platform: 'neutral',
  target: 'es2017', tsconfig: '../tsconfig.json', outfile: 'miniprogram/runtime/story-runtime.js',
  mainFields: ['module', 'main'], legalComments: 'none', minify: true,
})
