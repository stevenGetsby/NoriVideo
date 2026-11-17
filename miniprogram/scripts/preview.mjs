import ci from 'miniprogram-ci'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appid = process.env.MP_APP_ID
const privateKeyPath = process.env.MP_CI_PRIVATE_KEY_PATH
if (!appid || !privateKeyPath) {
  console.error('需要环境变量 MP_APP_ID 和 MP_CI_PRIVATE_KEY_PATH')
  process.exit(1)
}

const project = new ci.Project({
  appid,
  type: 'miniProgram',
  projectPath: projectRoot,
  privateKeyPath,
  ignores: ['node_modules/**/*'],
})

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const qrcodeOutputDest = path.resolve(projectRoot, 'dist-preview', `preview-${stamp}.png`)

await ci.preview({
  project,
  desc: 'preview',
  setting: { es6: true, minify: true },
  qrcodeFormat: 'image',
  qrcodeOutputDest,
  onProgressUpdate: () => {},
})

console.log('预览二维码已生成:', qrcodeOutputDest)
