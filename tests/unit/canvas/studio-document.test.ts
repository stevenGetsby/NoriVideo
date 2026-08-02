import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDIO_SCENE,
  mergeCanvasStudioScenes,
  type CanvasStudioObject,
} from '@/features/canvas/studio-types'
import {
  MAX_STUDIO_DOCUMENT_BYTES,
  validateStudioDocumentSaveInput,
} from '@/lib/canvas/studio-document'

function box(id: string, name = id): CanvasStudioObject {
  return {
    id,
    name,
    kind: 'box',
    modelUrl: null,
    materialId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#94a3b8',
    opacity: 1,
    visible: true,
    locked: false,
  }
}

describe('3D studio independent document contract', () => {
  it('accepts a normalized scene and preserves the optimistic revision', () => {
    const result = validateStudioDocumentSaveInput({
      expectedRevision: 7,
      clientId: 'tab-a',
      document: DEFAULT_STUDIO_SCENE,
    })

    expect(result).toMatchObject({
      success: true,
      data: { expectedRevision: 7, clientId: 'tab-a' },
    })
  })

  it('accepts persisted director view, snap surfaces and manual camera rotation', () => {
    const result = validateStudioDocumentSaveInput({
      expectedRevision: 1,
      document: {
        ...DEFAULT_STUDIO_SCENE,
        directorCamera: { position: [8, 4, 7], target: [0, 1, 0], fov: 50, roll: 6 },
        objects: [{
          ...box('surface'),
          kind: 'model',
          modelUrl: '/models/set.glb',
          snapSurface: true,
        }],
        cameras: [{
          id: 'camera-1', name: '旋转机位', position: [0, 2, 6], target: [0, 1, 0],
          rotation: [0.1, 0.2, 0.3], orientationMode: 'rotation', fov: 45,
        }],
      },
    })

    expect(result).toMatchObject({ success: true })
  })

  it('rejects invalid references and duplicate identifiers', () => {
    const result = validateStudioDocumentSaveInput({
      expectedRevision: 0,
      document: {
        ...DEFAULT_STUDIO_SCENE,
        objects: [box('same'), box('same')],
        cameras: [{
          id: 'camera-1',
          name: '机位',
          position: [0, 2, 6],
          target: [0, 1, 0],
          fov: 45,
          lookAtObjectId: 'missing-object',
        }],
      },
    })

    expect(result).toMatchObject({
      success: false,
      error: { code: 'STUDIO_DOCUMENT_INVALID' },
    })
  })

  it('returns the independent document byte budget', () => {
    const result = validateStudioDocumentSaveInput({
      expectedRevision: 0,
      document: {
        ...DEFAULT_STUDIO_SCENE,
        ignoredPadding: 'x'.repeat(MAX_STUDIO_DOCUMENT_BYTES),
      },
    })

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'STUDIO_DOCUMENT_TOO_LARGE',
        maxBytes: MAX_STUDIO_DOCUMENT_BYTES,
      },
    })
  })

  it('three-way merges local edits and deletes with concurrent server additions', () => {
    const base = {
      ...DEFAULT_STUDIO_SCENE,
      backgroundColor: '#111111',
      objects: [box('keep', 'base'), box('delete', 'delete me')],
    }
    const local = {
      ...base,
      backgroundColor: '#222222',
      objects: [box('keep', 'local edit'), box('local-add', 'local add')],
    }
    const server = {
      ...base,
      backgroundColor: '#333333',
      showGrid: false,
      objects: [box('keep', 'server edit'), box('delete', 'server edit'), box('server-add', 'server add')],
    }

    const merged = mergeCanvasStudioScenes(base, local, server)

    expect(merged.backgroundColor).toBe('#222222')
    expect(merged.showGrid).toBe(false)
    expect(merged.objects.map((object) => [object.id, object.name])).toEqual([
      ['keep', 'local edit'],
      ['local-add', 'local add'],
      ['server-add', 'server add'],
    ])
  })
})
