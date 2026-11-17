import ci from 'miniprogram-ci'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')
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

const version = pkg.version || '1.0.0'

await ci.upload({
  project,
  version,
  desc: '体验版',
  setting: { es6: true, minify: true },
  onProgressUpdate: () => {},
})

console.log('体验版已上传:', version)
