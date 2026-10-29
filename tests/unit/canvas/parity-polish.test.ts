import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeDeletedCanvasGroupMembers } from '@/lib/canvas/group-membership'
import { resolveConfiguredModelAvailability } from '@/lib/platform-services/model-availability'
import type { PlatformServiceConfigResponse } from '@/lib/platform-services/config'
import { isCanvasClipboardMimeAvailable, isCanvasClipboardTextAvailable } from '@/features/canvas/clipboard'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function serviceConfig(overrides: Partial<PlatformServiceConfigResponse> = {}): PlatformServiceConfigResponse {
  return {
    sourceFile: 'services.json',
    updatedAt: null,
    providers: [{ id: 'hfsy', name: 'HFSY', hasApiKey: true }],
    models: [{ modelId: 'gpt-image-2', modelKey: 'hfsy::gpt-image-2', name: 'Image', type: 'image', provider: 'hfsy' }],
    defaultModels: {},
    businessModels: [],
    modelRouting: {
      'nori::nori-gpt': '',
      'nori::nori-gpt-max': '',
      'nori::nori-gemini': '',
      'nori::nori-deepseek': '',
      'nori::nori-image-mini': '',
      'nori::nori-image-fast': '',
      'nori::nori-image': 'hfsy::gpt-image-2',
      'nori::nori-image-pro': '',
      'nori::seedance2.0-mini': '',
      'nori::seedance2.0-fast': '',
      'nori::seedance2.0': '',
      'nori::norivideo2.5': '',
      'nori::nori-audio': '',
      'nori::nori-music': '',
      'nori::nori-sfx': '',
    },
    storage: {
      type: 'tos', endpoint: '', publicEndpoint: '', region: '', bucket: '', forcePathStyle: false,
      hasAccessKey: false, hasSecretKey: false,
    },
    ...overrides,
  }
}

describe('canvas parity polish contracts', () => {
  it('resolves configured image models from admin routing and cached health without probing', () => {
    const config = serviceConfig()
    const now = new Date('2026-07-18T00:05:00.000Z')
    expect(resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-image', type: 'image', config, health: [], now,
    })).toMatchObject({ configured: true, available: true, runtimeModelKey: 'hfsy::gpt-image-2', healthStatus: 'unknown' })

    expect(resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-image', type: 'image', config,
      health: [{ targetType: 'provider', targetId: 'hfsy', status: 'healthy', message: '连接正常', checkedAt: '2026-07-18T00:00:00.000Z' }],
      now,
    })).toMatchObject({ configured: true, available: true, healthStatus: 'healthy', healthMessage: '连接正常' })

    expect(resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-image', type: 'image', config,
      health: [{ targetType: 'provider', targetId: 'hfsy', status: 'unhealthy', message: 'HTTP 401', checkedAt: '2026-07-18T00:00:00.000Z' }],
      now,
    })).toMatchObject({ configured: true, available: false, healthStatus: 'unhealthy', unavailableReason: 'HTTP 401' })

    expect(resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-image', type: 'image', config,
      health: [{ targetType: 'provider', targetId: 'hfsy', status: 'unhealthy', message: 'HTTP 401', checkedAt: '2026-07-17T23:00:00.000Z' }],
      now,
    })).toMatchObject({ configured: true, available: true, healthStatus: 'unknown', unavailableReason: null })

    const missingKey = serviceConfig({ providers: [{ id: 'hfsy', name: 'HFSY', hasApiKey: false }] })
    expect(resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-image', type: 'image', config: missingKey, health: [], now,
    })).toMatchObject({ configured: false, available: false })
    expect(resolveConfiguredModelAvailability({
      modelKey: 'nori::seedance2.0', type: 'video', config, health: [], now,
    })).toMatchObject({ configured: false, available: false, runtimeModelKey: null })
  })

  it('removes production nodes from persisted group membership during sync', () => {
    const unchanged = { title: '组', memberIds: ['creative-1'] }
    expect(removeDeletedCanvasGroupMembers(unchanged, new Set(['production-1']))).toBeNull()
    expect(removeDeletedCanvasGroupMembers({
      title: '混合组', memberIds: ['creative-1', 'production-1', 'production-2'], color: '#fff',
    }, new Set(['production-1', 'production-2']))).toEqual({
      title: '混合组', memberIds: ['creative-1'], color: '#fff',
    })
    expect(source('src/app/api/projects/[projectId]/canvas/[canvasId]/production-sync/route.ts'))
      .toContain('removeDeletedCanvasGroupMembers(group.data, deletedNodeIds)')
  })

  it('only enables pane paste for actual clipboard content', () => {
    expect(isCanvasClipboardTextAvailable('')).toBe(false)
    expect(isCanvasClipboardTextAvailable('普通文本')).toBe(true)
    expect(isCanvasClipboardTextAvailable('NORI_CANVAS:{"nodes":[]}')).toBe(false)
    expect(isCanvasClipboardTextAvailable('NORI_CANVAS:{"nodes":[{"id":"n1"}]}')).toBe(true)
    expect(isCanvasClipboardTextAvailable('NORI_CANVAS:not-json')).toBe(false)
    expect(isCanvasClipboardMimeAvailable(['image/png'])).toBe(true)
    expect(isCanvasClipboardMimeAvailable(['video/mp4'])).toBe(true)
    expect(isCanvasClipboardMimeAvailable(['audio/mpeg'])).toBe(true)
    expect(isCanvasClipboardMimeAvailable(['model/gltf-binary'])).toBe(true)
    expect(isCanvasClipboardMimeAvailable(['text/plain'])).toBe(false)

    const graph = source('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('canPaste={!readOnly && clipboardCanPaste}')
    expect(graph).toContain('void refreshClipboardAvailability()')
  })

  it('binds material filters to persisted fields and enforces the soft-delete contract', () => {
    const library = source('src/components/frameos/views/FosMaterialLibrary.tsx')
    const route = source('src/app/api/frameos/materials/route.ts')
    const schema = source('prisma/schema.prisma')

    expect(library).toContain("params.set('source', sourceFilter)")
    expect(library).toContain("params.set('creator', creator.trim())")
    expect(library).toContain("params.set('createdFrom', createdFrom)")
    expect(library).toContain("setProjectId('global')")
    expect(library).toContain('canFavorite={canEditAssets}')
    expect(library).toContain('disabled={!canEditAssets}')
    expect(route).toContain('ownerName: creatorExact ? { equals: creator } : { contains: creator }')
    expect(route).toContain('createdAt: {')
    expect(route).toContain('ALLOWED_SOURCES')
    expect(route).toContain('deletedAt: deleted ? { not: null } : null')

    const model = schema.slice(schema.indexOf('model FrameosMaterial {'), schema.indexOf('model FrameosScript {'))
    expect(model).toContain('isFavorited')
    expect(model).toContain('ownerName')
    expect(model).toContain('createdAt')
    expect(model).toContain('deletedAt')
    expect(model).toContain('deletedById')
  })
})
