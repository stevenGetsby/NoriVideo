import { describe, expect, it } from 'vitest'
import {
  canvasOfflineDraftKey,
  createCanvasOfflineDraft,
  createMemoryCanvasOfflineDraftStore,
  deleteCanvasOfflineDraft,
  loadCanvasOfflineDraft,
  parseCanvasOfflineDraft,
  resolveCanvasOfflineRecoveryChoice,
  saveCanvasOfflineDraft,
  type CanvasOfflineNamespace,
} from '@/features/canvas/state/canvas-offline-store'
import type { CanvasDocumentInput } from '@/features/canvas/types'

function namespace(overrides: Partial<CanvasOfflineNamespace> = {}): CanvasOfflineNamespace {
  return {
    accountId: 'account-1',
    projectId: 'project-1',
    canvasId: 'canvas-1',
    ...overrides,
  }
}

function document(text = '本地修改'): CanvasDocumentInput {
  return {
    expectedRevision: 7,
    clientId: 'tab-original',
    changeSummary: '编辑画布',
    viewport: { x: 120, y: -45, zoom: 0.8 },
    nodes: [{
      id: 'node-1',
      canvasId: 'canvas-1',
      type: 'note',
      position: { x: 20, y: 30 },
      size: null,
      data: { text },
      status: 'IDLE',
      taskId: null,
      runId: null,
      mediaObjectId: null,
      parentNodeId: null,
    }],
    edges: [],
  }
}

describe('canvas offline draft store', () => {
  it('strictly isolates drafts by account, project, and canvas', async () => {
    const store = createMemoryCanvasOfflineDraftStore()
    const firstNamespace = namespace()
    const otherAccount = namespace({ accountId: 'account-2' })
    const otherProject = namespace({ projectId: 'project-2' })
    const otherCanvas = namespace({ canvasId: 'canvas-2' })

    await saveCanvasOfflineDraft(createCanvasOfflineDraft({
      namespace: firstNamespace,
      document: document('账号一'),
    }), store)
    await saveCanvasOfflineDraft(createCanvasOfflineDraft({
      namespace: otherAccount,
      document: document('账号二'),
    }), store)

    expect(canvasOfflineDraftKey(firstNamespace)).not.toBe(canvasOfflineDraftKey(otherAccount))
    expect(canvasOfflineDraftKey(firstNamespace)).not.toBe(canvasOfflineDraftKey(otherProject))
    expect(canvasOfflineDraftKey(firstNamespace)).not.toBe(canvasOfflineDraftKey(otherCanvas))
    expect((await loadCanvasOfflineDraft(firstNamespace, store))?.document.nodes[0]?.data?.text).toBe('账号一')
    expect((await loadCanvasOfflineDraft(otherAccount, store))?.document.nodes[0]?.data?.text).toBe('账号二')
    expect(await loadCanvasOfflineDraft(otherProject, store)).toBeNull()
    expect(await loadCanvasOfflineDraft(otherCanvas, store)).toBeNull()

    await deleteCanvasOfflineDraft(firstNamespace, store)
    expect(await loadCanvasOfflineDraft(firstNamespace, store)).toBeNull()
    expect(await loadCanvasOfflineDraft(otherAccount, store)).not.toBeNull()
  })

  it('normalizes metadata and stores a detached document copy', async () => {
    const store = createMemoryCanvasOfflineDraftStore()
    const source = document()
    const draft = createCanvasOfflineDraft({
      namespace: namespace(),
      document: source,
      retryAttempt: 2.9,
      lastError: '  网络暂不可用  ',
      updatedAt: 123_456,
    })

    source.nodes[0]!.data = { text: '调用方后来修改' }
    await saveCanvasOfflineDraft(draft, store)
    draft.document.nodes[0]!.data = { text: '保存后又修改' }

    const restored = await loadCanvasOfflineDraft(namespace(), store)
    expect(restored).toMatchObject({
      schema_version: 1,
      baseRevision: 7,
      lastServerRevision: 7,
      pendingOps: [],
      dirty: true,
      retryAttempt: 2,
      lastError: '网络暂不可用',
      updatedAt: 123_456,
    })
    expect(restored?.document.nodes[0]?.data?.text).toBe('本地修改')
    expect(restored?.document.schema_version).toBe(1)
    expect(createCanvasOfflineDraft({
      namespace: namespace(),
      document: document(),
      retryAttempt: Number.POSITIVE_INFINITY,
    }).retryAttempt).toBe(0)
  })

  it('rejects malformed or cross-namespace persisted data without throwing', () => {
    const valid = createCanvasOfflineDraft({ namespace: namespace(), document: document() })
    const brokenNamespace = { ...valid, namespace: { accountId: null } }
    const brokenDocument = {
      ...valid,
      document: { ...valid.document, viewport: { x: Number.NaN, y: 0, zoom: 1 } },
    }

    expect(() => parseCanvasOfflineDraft(brokenNamespace, namespace())).not.toThrow()
    expect(parseCanvasOfflineDraft(brokenNamespace, namespace())).toBeNull()
    expect(parseCanvasOfflineDraft(brokenDocument, namespace())).toBeNull()
    expect(parseCanvasOfflineDraft(valid, namespace({ accountId: 'account-2' }))).toBeNull()
  })

  it('loads legacy full-document drafts and persists new pending operation metadata', () => {
    const current = createCanvasOfflineDraft({
      namespace: namespace(),
      document: document(),
      lastServerRevision: 7,
      pendingOps: [{ type: 'node.delete', id: 'node-old' }],
    })
    const legacy = { ...current } as Partial<typeof current>
    const legacyEnvelope = { ...legacy, schemaVersion: legacy.schema_version }
    delete legacyEnvelope.schema_version
    delete legacy.pendingOps
    delete legacy.lastServerRevision
    delete legacyEnvelope.pendingOps
    delete legacyEnvelope.lastServerRevision

    expect(parseCanvasOfflineDraft(legacy, namespace())).toMatchObject({
      document: { expectedRevision: 7 },
      pendingOps: [],
      lastServerRevision: 7,
    })
    expect(parseCanvasOfflineDraft(current, namespace())).toMatchObject({
      pendingOps: [{ type: 'node.delete', id: 'node-old' }],
      lastServerRevision: 7,
    })
    expect(parseCanvasOfflineDraft(legacyEnvelope, namespace())).toMatchObject({
      schema_version: 1,
      document: { schema_version: 1, expectedRevision: 7 },
    })
  })

  it('rebases a recovered local document without mutating the stored draft', () => {
    const draft = createCanvasOfflineDraft({ namespace: namespace(), document: document() })
    const restored = resolveCanvasOfflineRecoveryChoice({
      draft,
      choice: 'local',
      serverRevision: 11,
      clientId: 'tab-current',
    })

    expect(restored).toMatchObject({
      expectedRevision: 11,
      clientId: 'tab-current',
      changeSummary: '恢复本地未同步版本',
    })
    expect(restored?.nodes[0]?.data?.text).toBe('本地修改')
    expect(draft.document.expectedRevision).toBe(7)
    expect(draft.document.clientId).toBe('tab-original')
    expect(resolveCanvasOfflineRecoveryChoice({
      draft,
      choice: 'server',
      serverRevision: 11,
      clientId: 'tab-current',
    })).toBeNull()
  })
})
