#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import { pathToFileURL } from 'url'
import ts from 'typescript'

const root = process.cwd()
const apiDir = path.join(root, 'src', 'app', 'api')

export const API_HANDLER_ALLOWLIST = new Set([
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/files/[...path]/route.ts',
])

export const PUBLIC_ROUTE_ALLOWLIST = new Set([
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/cos/image/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/app/api/mp/auth/login/route.ts',
  'src/app/api/mp/rankings/[kind]/route.ts',
  'src/app/api/mp/releases/[releaseId]/stats/route.ts',
  'src/app/api/mp/search/route.ts',
  'src/app/api/mp/topics/[slug]/route.ts',
  'src/app/api/mp/works/route.ts',
  'src/app/api/storage/sign/route.ts',
])

export const SESSION_AUTH_ROUTE_ALLOWLIST = new Set([
  // Initial password changes must run before the normal session guard's
  // PASSWORD_CHANGE_REQUIRED rejection; the route verifies account state itself.
  'src/app/api/auth/change-password/route.ts',
])

const AUTH_CALL_PATTERNS = [
  /\brequireAdminAuth\s*\(/,
  /\brequireSuperAdminAuth\s*\(/,
  /\brequireUserAuth\s*\(/,
  /\brequireUserPermission\s*\(/,
  /\brequireProjectAuth\s*\(/,
  /\brequireProjectAuthLight\s*\(/,
  // Assignment route shims delegate authentication to these shared HTTP
  // handlers. Keep this narrow so arbitrary helper delegation cannot bypass
  // the route auth contract.
  /\bhandleAssignment(?:Get|Post)\s*\(/,
]

function fail(title, details = []) {
  process.stderr.write(`\n[api-route-contract-guard] ${title}\n`)
  for (const detail of details) {
    process.stderr.write(`  - ${detail}\n`)
  }
  process.exit(1)
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, out)
      continue
    }
    if (entry.name === 'route.ts') out.push(fullPath)
  }
  return out
}

function toRel(fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/')
}

function hasApiHandlerWrapper(content) {
  return /\bapiHandler\s*\(/.test(content)
}

// C 端（/api/mp/*）用独立的 consumer JWT 鉴权，与 B 端 session 完全隔离（R4）。
// 只放行 mp 前缀，B 端路由仍然必须使用 session 鉴权。
const CONSUMER_AUTH_CALL_PATTERNS = [
  /\brequireConsumerAuth\s*\(/,
  /\boptionalConsumer\s*\(/,
]

// Douyin consumers use a different token audience from both the workbench
// and WeChat. Only recognize the exact entry points, with their existing
// auth/app checks in every exported handler. In particular, guest telemetry
// isn't permission to use an optional token on any other endpoint.
const dyAuth = '@/lib/mp/dy/auth'
const dyProtected = [[dyAuth, 'dyAppIdOf'], [dyAuth, 'requireDyUser'], [dyAuth, 'assertUserApp']]
const dyRateLimit = ['@/lib/rate-limit', 'checkRateLimit']
const dyContracts = new Map([
  ['src/app/api/mp/dy/play/route.ts', { methods: ['GET'], calls: dyProtected }],
  ['src/app/api/mp/dy/save/route.ts', { methods: ['GET', 'PUT'], calls: dyProtected }],
  ['src/app/api/mp/dy/shares/route.ts', { methods: ['POST'], calls: dyProtected }],
  ['src/app/api/mp/dy/login/route.ts', { methods: ['POST'], calls: [
    dyRateLimit, [dyAuth, 'dyAppIdOf'], ['@/lib/mp/dy/apps', 'getDyAppSecret'],
    ['@/lib/mp/dy/session', 'dyCode2Session'], ['@/lib/mp/dy/users', 'loginDyUser'], ['@/lib/mp/token', 'signConsumerToken'],
  ] }],
  ['src/app/api/mp/dy/track/route.ts', { methods: ['POST'], calls: [
    [dyAuth, 'dyAppIdOf'], ['@/lib/mp/dy/apps', 'getDyApp'], [dyAuth, 'optionalDyUser'],
    dyRateLimit, ['@/lib/mp/dy/events', 'ingestDyEvents'],
  ] }],
])

function satisfiesDyContract(relPath, content, contract) {
  const source = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true)
  const imports = new Map()
  const handlers = new Map()
  const httpMethods = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings
      if (!statement.importClause?.isTypeOnly && bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) if (!item.isTypeOnly) {
          imports.set(item.name.text, `${statement.moduleSpecifier.text}:${item.propertyName?.text ?? item.name.text}`)
        }
      }
    }
    if (!statement.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isFunctionDeclaration(statement) && httpMethods.has(statement.name?.text)) return false
    if (ts.isVariableStatement(statement)) {
      for (const item of statement.declarationList.declarations) {
        if (ts.isIdentifier(item.name) && httpMethods.has(item.name.text)) handlers.set(item.name.text, item.initializer)
      }
    }
  }
  if (handlers.size !== contract.methods.length) return false
  return contract.methods.every((method) => {
    const handler = handlers.get(method)
    if (!handler || !ts.isCallExpression(handler) || !ts.isIdentifier(handler.expression)
      || imports.get(handler.expression.text) !== '@/lib/api-errors:apiHandler') return false
    const callback = handler.arguments[0]
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) || !ts.isBlock(callback.body)) return false
    const called = []
    for (const statement of callback.body.statements) {
      if (ts.isReturnStatement(statement)) break
      const expressions = ts.isVariableStatement(statement) ? statement.declarationList.declarations.map((item) => item.initializer)
        : ts.isExpressionStatement(statement) ? [statement.expression] : []
      for (const raw of expressions) {
        const expression = raw && ts.isAwaitExpression(raw) ? raw.expression : raw
        if (expression && ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) called.push(imports.get(expression.expression.text))
      }
    }
    let previous = -1
    return contract.calls.every(([module, name]) => {
      previous = called.indexOf(`${module}:${name}`, previous + 1)
      return previous !== -1
    })
  })
}

function hasRequiredAuth(relPath, content) {
  const dyContract = dyContracts.get(relPath)
  if (dyContract) return satisfiesDyContract(relPath, content, dyContract)
  if (SESSION_AUTH_ROUTE_ALLOWLIST.has(relPath) && /\bgetAuthSession\s*\(/.test(content)) return true
  if (relPath.startsWith('src/app/api/mp/') && CONSUMER_AUTH_CALL_PATTERNS.some((pattern) => pattern.test(content))) return true
  return AUTH_CALL_PATTERNS.some((pattern) => pattern.test(content))
}

export function inspectRouteContract(relPath, content) {
  const violations = []

  if (!API_HANDLER_ALLOWLIST.has(relPath) && !hasApiHandlerWrapper(content)) {
    violations.push(`${relPath} missing apiHandler wrapper`)
  }

  if (!PUBLIC_ROUTE_ALLOWLIST.has(relPath) && !hasRequiredAuth(relPath, content)) {
    violations.push(`${relPath} missing requireUserAuth/requireUserPermission/requireProjectAuth/requireProjectAuthLight`)
  }

  return violations
}

export function findApiRouteContractViolations(scanRoot = root) {
  const routesRoot = path.join(scanRoot, 'src', 'app', 'api')
  return walk(routesRoot)
    .map((fullPath) => {
      const relPath = path.relative(scanRoot, fullPath).split(path.sep).join('/')
      const content = fs.readFileSync(fullPath, 'utf8')
      return inspectRouteContract(relPath, content)
    })
    .flat()
}

export function main() {
  if (!fs.existsSync(apiDir)) {
    fail('Missing src/app/api directory')
  }

  const violations = walk(apiDir)
    .map((fullPath) => {
      const relPath = toRel(fullPath)
      const content = fs.readFileSync(fullPath, 'utf8')
      return inspectRouteContract(relPath, content)
    })
    .flat()

  if (violations.length > 0) {
    fail('Found API route contract violations', violations)
  }

  process.stdout.write(
    `[api-route-contract-guard] OK routes=${walk(apiDir).length} public=${PUBLIC_ROUTE_ALLOWLIST.size} apiHandlerExceptions=${API_HANDLER_ALLOWLIST.size}\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
