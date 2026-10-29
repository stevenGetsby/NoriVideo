import fs from 'node:fs'
import path from 'node:path'
import { isSupportedModelProvider } from '@/lib/model-provider-contract'

export type ServiceConfigLlmProtocol = 'chat' | 'responses'
export type ServiceConfigModelType = 'llm' | 'image' | 'video' | 'audio' | 'lipsync'

export interface ServiceConfigStorageTos {
  endpoint?: string
  publicEndpoint?: string
  region?: string
  bucket?: string
  accessKey?: string
  secretKey?: string
  forcePathStyle?: boolean
}

export interface ServiceConfigStorage {
  type?: 'tos' | 'minio' | 'local' | 'cos'
  tos?: ServiceConfigStorageTos
}

export interface ServiceConfigProvider {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  assetGroupId?: string
}

export interface ServiceConfigModel {
  modelId: string
  modelKey?: string
  name?: string
  type: ServiceConfigModelType
  provider: string
  llmProtocol?: 'responses' | 'chat-completions'
  price?: number
}

export interface ServiceConfigDefaultModels {
  analysisModel?: string
  characterModel?: string
  locationModel?: string
  storyboardModel?: string
  editModel?: string
  videoModel?: string
  audioModel?: string
  lipSyncModel?: string
}

export interface ServiceConfigLlm {
  providers?: ServiceConfigProvider[]
  models?: ServiceConfigModel[]
  defaultModels?: ServiceConfigDefaultModels
  modelRouting?: Record<string, string>
}

export interface ServiceConfigModel3DFrameos {
  /**
   * `tripo-v2` talks to Tripo's public async task API. `frameos-v1` is the
   * branded Nori/FrameOS contract for a self-hosted compatible gateway.
   */
  protocol?: 'tripo-v2' | 'frameos-v1'
  baseUrl?: string
  apiKey?: string
  modelVersion?: string
  createPath?: string
  taskPath?: string
  pollIntervalMs?: number
  timeoutMs?: number
}

export interface ServiceConfigModel3D {
  frameos3d?: ServiceConfigModel3DFrameos
}

export interface ServiceConfig {
  storage?: ServiceConfigStorage
  llm?: ServiceConfigLlm
  model3d?: ServiceConfigModel3D
}

type ParsedYamlLine = {
  indent: number
  content: string
}

let cachedConfig: ServiceConfig | null = null
let cachedPath: string | null = null
let cachedSignature: string | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePath(input: string): string {
  return path.isAbsolute(input) ? input : path.join(process.cwd(), input)
}

function candidateConfigPaths(): string[] {
  const configuredPath = compact(process.env.NORI_SERVICE_CONFIG)
  if (configuredPath) return [normalizePath(configuredPath)]
  return [
    'config/services.local.json',
    'config/services.local.yaml',
    'config/services.local.yml',
    'config/services.json',
    'config/services.yaml',
    'config/services.yml',
  ].map((item) => path.join(process.cwd(), item))
}

export function resolveServiceConfigPath(): string | null {
  for (const candidate of candidateConfigPaths()) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : (quote || char)
      continue
    }
    if (!quote && char === '#' && (index === 0 || /\s/.test(value[index - 1] || ''))) {
      return value.slice(0, index).trimEnd()
    }
  }
  return value.trimEnd()
}

function parseYamlScalar(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ''
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

function splitYamlKeyValue(content: string): [string, string] {
  let colonIndex = -1
  let quote: '"' | "'" | null = null
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    if ((char === '"' || char === "'") && content[index - 1] !== '\\') {
      quote = quote === char ? null : (quote || char)
      continue
    }
    if (!quote && char === ':' && (index === content.length - 1 || /\s/.test(content[index + 1] || ''))) {
      colonIndex = index
      break
    }
  }
  if (colonIndex < 0) return [content.trim(), '']
  const rawKey = content.slice(0, colonIndex).trim()
  const key = (rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))
    ? rawKey.slice(1, -1)
    : rawKey
  return [key, content.slice(colonIndex + 1).trim()]
}

function parseYamlBlock(lines: ParsedYamlLine[], startIndex: number, indent: number): { value: unknown; nextIndex: number } {
  const first = lines[startIndex]
  if (!first || first.indent < indent) return { value: {}, nextIndex: startIndex }
  const isArray = first.indent === indent && first.content.startsWith('- ')
  if (isArray) {
    const result: unknown[] = []
    let index = startIndex
    while (index < lines.length) {
      const line = lines[index]
      if (line.indent < indent || line.indent !== indent || !line.content.startsWith('- ')) break
      const item = line.content.slice(2).trim()
      index += 1
      if (!item) {
        const parsed = parseYamlBlock(lines, index, indent + 2)
        result.push(parsed.value)
        index = parsed.nextIndex
        continue
      }
      if (item.includes(':')) {
        const [key, rawValue] = splitYamlKeyValue(item)
        const object: Record<string, unknown> = {}
        object[key] = rawValue ? parseYamlScalar(rawValue) : {}
        if (index < lines.length && lines[index].indent > indent) {
          const parsed = parseYamlBlock(lines, index, indent + 2)
          if (isRecord(parsed.value)) {
            Object.assign(object, parsed.value)
          }
          index = parsed.nextIndex
        }
        result.push(object)
      } else {
        result.push(parseYamlScalar(item))
      }
    }
    return { value: result, nextIndex: index }
  }

  const result: Record<string, unknown> = {}
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index]
    if (line.indent < indent || line.indent !== indent || line.content.startsWith('- ')) break
    const [key, rawValue] = splitYamlKeyValue(line.content)
    index += 1
    if (rawValue) {
      result[key] = parseYamlScalar(rawValue)
    } else {
      const parsed = parseYamlBlock(lines, index, indent + 2)
      result[key] = parsed.value
      index = parsed.nextIndex
    }
  }
  return { value: result, nextIndex: index }
}

function parseSimpleYaml(content: string): unknown {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line): ParsedYamlLine | null => {
      const stripped = stripInlineComment(line)
      if (!stripped.trim()) return null
      const indent = stripped.match(/^ */)?.[0].length || 0
      return { indent, content: stripped.trim() }
    })
    .filter((line): line is ParsedYamlLine => Boolean(line))
  if (lines.length === 0) return {}
  return parseYamlBlock(lines, 0, lines[0].indent).value
}

function parseServiceConfigFile(filePath: string): ServiceConfig {
  const raw = fs.readFileSync(filePath, 'utf8')
  const lower = filePath.toLowerCase()
  const parsed = lower.endsWith('.json')
    ? JSON.parse(raw)
    : parseSimpleYaml(raw)
  if (!isRecord(parsed)) {
    throw new Error(`SERVICE_CONFIG_INVALID: root must be an object (${filePath})`)
  }
  return parsed as ServiceConfig
}

function fileSignature(filePath: string): string {
  const stat = fs.statSync(filePath)
  return `${stat.mtimeMs}:${stat.size}:${stat.ino}`
}

export function readServiceConfig(): ServiceConfig {
  const filePath = resolveServiceConfigPath()
  if (!filePath) return {}
  const signature = fileSignature(filePath)
  if (cachedConfig && cachedPath === filePath && cachedSignature === signature) return cachedConfig
  cachedConfig = parseServiceConfigFile(filePath)
  cachedPath = filePath
  cachedSignature = signature
  return cachedConfig
}

export function resetServiceConfigCache() {
  cachedConfig = null
  cachedPath = null
  cachedSignature = null
}

export function getServiceConfigRevision(): string {
  const filePath = resolveServiceConfigPath()
  return filePath ? `${filePath}:${fileSignature(filePath)}` : 'none'
}

export function getServiceStorageConfig(): ServiceConfigStorage | undefined {
  return readServiceConfig().storage
}

export function getServiceLlmConfig(): ServiceConfigLlm | undefined {
  const config = readServiceConfig().llm
  if (!config) return undefined
  const providers = (config.providers || []).filter((provider) => isSupportedModelProvider(provider.id))
  const providerIds = new Set(providers.map((provider) => provider.id))
  return {
    ...config,
    providers,
    models: (config.models || []).filter((model) => providerIds.has(model.provider)),
    modelRouting: Object.fromEntries(Object.entries(config.modelRouting || {}).filter(([, value]) => {
      const normalized = compact(value)
      // An explicit empty route means the administrator disabled this
      // capability. Keep it so it cannot fall back to the suggested route.
      if (!normalized) return true
      const provider = normalized.split('::')[0]
      return providerIds.has(provider)
    })),
  }
}

export function getServiceModel3DConfig(): ServiceConfigModel3D | undefined {
  return readServiceConfig().model3d
}

export function getServiceDefaultModel(field: keyof ServiceConfigDefaultModels): string {
  return compact(getServiceLlmConfig()?.defaultModels?.[field])
}
