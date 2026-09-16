import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const EXPECTED = Object.freeze({
  STORAGE_TYPE: 'tos',
  TOS_ENDPOINT: 'https://tos-cn-beijing.volces.com',
  TOS_PUBLIC_ENDPOINT: 'https://tos-cn-beijing.volces.com',
  TOS_REGION: 'cn-beijing',
  TOS_BUCKET: 'nori-test',
})

const EXPECTED_SECRET_SHA256 = Object.freeze({
  TOS_ACCESS_KEY: 'a27f907085e33480980c2dc471018da0c5f572f22c0cf07d3a3ecf5231e7c4c6',
  TOS_SECRET_KEY: '156ebf586120608514fa520463a1c45f5be41e0e7d8fad9327d0b4ff88959877',
})

const PUBLIC_KEYS = Object.keys(EXPECTED)
const SECRET_KEYS = Object.keys(EXPECTED_SECRET_SHA256)
const ALL_KEYS = [...PUBLIC_KEYS, ...SECRET_KEYS]

function compact(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseEnvFile(filePath) {
  const values = {}
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function storageConfigValues(config) {
  const storage = config?.storage
  const tos = storage?.tos
  return {
    STORAGE_TYPE: storage?.type,
    TOS_ENDPOINT: tos?.endpoint,
    TOS_PUBLIC_ENDPOINT: tos?.publicEndpoint,
    TOS_REGION: tos?.region,
    TOS_BUCKET: tos?.bucket,
    TOS_ACCESS_KEY: tos?.accessKey,
    TOS_SECRET_KEY: tos?.secretKey,
  }
}

function validateValues(source, values, { requireAll }) {
  const failures = []
  const suppliedKeys = ALL_KEYS.filter((key) => compact(values[key]))

  if (!requireAll && suppliedKeys.length === 0) return

  for (const key of PUBLIC_KEYS) {
    const value = compact(values[key])
    if (!value && requireAll) {
      failures.push(`${key} is missing`)
    } else if (value && value !== EXPECTED[key]) {
      failures.push(`${key} does not match the fixed TOS policy`)
    }
  }

  for (const key of SECRET_KEYS) {
    const value = compact(values[key])
    if (!value && requireAll) {
      failures.push(`${key} is missing`)
    } else if (value && sha256(value) !== EXPECTED_SECRET_SHA256[key]) {
      failures.push(`${key} fingerprint does not match the fixed TOS policy`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`${source}: ${failures.join('; ')}`)
  }
}

function validateJsonConfig(filePath) {
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  validateValues(filePath, storageConfigValues(config), { requireAll: true })
  if (config.storage?.tos?.forcePathStyle !== false) {
    throw new Error(`${filePath}: storage.tos.forcePathStyle must be false`)
  }
}

function validateLocalWorkspace() {
  const root = process.cwd()
  const primaryEnv = path.join(root, '.env')
  if (!fs.existsSync(primaryEnv)) throw new Error(`${primaryEnv}: required fixed TOS secret file is missing`)
  validateValues(primaryEnv, parseEnvFile(primaryEnv), { requireAll: true })

  for (const name of ['.env.local', '.deploy.env']) {
    const filePath = path.join(root, name)
    if (fs.existsSync(filePath)) {
      validateValues(filePath, parseEnvFile(filePath), { requireAll: false })
    }
  }

  validateValues('process environment', process.env, { requireAll: false })

  let configCount = 0
  for (const name of ['config/services.json', 'config/services.prod.json', 'data/services.prod.json']) {
    const filePath = path.join(root, name)
    if (!fs.existsSync(filePath)) continue
    validateJsonConfig(filePath)
    configCount += 1
  }
  if (configCount === 0) throw new Error('No local service config was found for fixed TOS validation')
}

function validateRuntime() {
  validateValues('container environment', process.env, { requireAll: true })
  const configuredPath = compact(process.env.NORI_SERVICE_CONFIG)
  if (!configuredPath) throw new Error('NORI_SERVICE_CONFIG is required by the fixed TOS runtime policy')
  const filePath = path.isAbsolute(configuredPath) ? configuredPath : path.join(process.cwd(), configuredPath)
  if (!fs.existsSync(filePath)) throw new Error(`${filePath}: runtime service config is missing`)
  validateJsonConfig(filePath)
}

try {
  if (process.argv.includes('--runtime')) validateRuntime()
  else validateLocalWorkspace()
  console.log('[fixed-tos] verified bucket=nori-test and locked credential fingerprints')
} catch (error) {
  console.error(`[fixed-tos] configuration rejected: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
