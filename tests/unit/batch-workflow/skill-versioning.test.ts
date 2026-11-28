import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => {
  const mockTx = {
    workflowSkill: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workflowTemplate: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    batchRun: { findMany: vi.fn(), findFirst: vi.fn() },
    batchItem: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  }
  return {
    ...mockTx,
    $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/platform-services/config', () => ({
  getPlatformServiceConfigResponse: () => ({ models: [], defaults: {} }),
}))
vi.mock('@/lib/platform-services/model-selection', () => ({
  resolveModelKeyForViewer: (_c: unknown, key: string) => ({ allowed: true, modelKey: key, reason: null }),
  resolveSelectableModelKeyForViewer: (_c: unknown, key: string) => key,
}))

import {
  getBatchRunById,
  getBatchRunWithStatusSync,
  listBatchRuns,
  mapBatchItemRow,
  publishWorkflowSkillVersion,
  toBatchItemSummary,
  toWorkflowSkillSummary,
  updateWorkflowSkill,
  updateWorkflowTemplate,
  type WorkflowSkillSummaryDTO,
} from '@/lib/batch-workflow/service'
import type { WorkflowSkillDTO } from '@/lib/batch-workflow/types'

function skillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-db-1',
    userId: 'ws-1',
    slug: 'demo-skill',
    name: 'Demo Skill',
    track: 'short_drama_commerce',
    stage: 'script_analysis',
    version: 1,
    parentSkillId: null,
    changeNote: 'v1',
    isDefault: false,
    description: 'Demo description',
    systemPrompt: 'ORIGINAL_PROMPT',
    fewShotExamples: [],
    outputSchema: null,
    modelPreferences: null,
    qcRules: null,
    createdAt: new Date('2026-11-28T00:00:00.000Z'),
    updatedAt: new Date('2026-11-28T00:00:00.000Z'),
    ...overrides,
  }
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    batchRunId: 'run-1',
    revision: 0,
    executionKey: null,
    index: 0,
    title: 'Item',
    inputPayload: {},
    currentStage: 'script_analysis',
    status: 'queued',
    stageStates: {},
    stageOutputs: {},
    errorMessage: null,
    createdAt: new Date('2026-11-28T00:00:00.000Z'),
    updatedAt: new Date('2026-11-28T00:00:00.000Z'),
    ...overrides,
  }
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    userId: 'ws-1',
    createdById: 'ws-1',
    workId: null,
    projectId: 'proj-1',
    templateId: 'tpl-1',
    templateSnapshot: {},
    title: 'Run',
    track: 'short_drama_commerce',
    runMode: 'gated',
    status: 'draft',
    totalItems: 0,
    completedItems: 0,
    failedItems: 0,
    createdAt: new Date('2026-11-28T00:00:00.000Z'),
    updatedAt: new Date('2026-11-28T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Skill publish: unique conflict retry & default transaction
// ============================================================
describe('publishWorkflowSkillVersion transactional contract', () => {
  beforeEach(() => {
    // First getWorkflowSkillById call resolves from DB row.
    prismaMock.workflowSkill.findFirst.mockImplementation(async (args: { where?: { id?: string; slug?: string } }) => {
      if (args?.where?.id === 'skill-db-1') return skillRow()
      if (args?.where?.slug === 'demo-skill') return skillRow()
      return null
    })
  })

  it('retries once on P2002 then succeeds with the next version', async () => {
    // First tx attempt: max version is 2 → tries v3 → P2002.
    // Second tx attempt: max version is 3 → tries v4 → success.
    const versions = [{ version: 2 }, { version: 3 }]
    prismaMock.workflowSkill.findFirst.mockImplementation(async (args: { where?: { id?: string; slug?: string }; select?: { version?: boolean } }) => {
      if (args?.where?.id === 'skill-db-1') return skillRow()
      if (args?.where?.slug === 'demo-skill' && args?.select?.version) return versions.shift() ?? { version: 3 }
      if (args?.where?.slug === 'demo-skill') return skillRow()
      return null
    })
    let createCalls = 0
    prismaMock.workflowSkill.create.mockImplementation(async ({ data }: { data: { version: number; systemPrompt: string } }) => {
      createCalls += 1
      if (createCalls === 1) {
        const err = new Error('Unique constraint failed') as Error & { code: string }
        err.code = 'P2002'
        throw err
      }
      return skillRow({ id: 'skill-db-2', version: data.version, systemPrompt: data.systemPrompt })
    })

    const result = await publishWorkflowSkillVersion({
      workspaceOwnerId: 'ws-1',
      skillId: 'skill-db-1',
      input: { systemPrompt: 'NEW_PROMPT' },
    })
    expect(result.version).toBe(4)
    expect(result.systemPrompt).toBe('NEW_PROMPT')
    expect(createCalls).toBe(2)
  })

  it('throws a clear INVALID_PARAMS after a second P2002 conflict', async () => {
    prismaMock.workflowSkill.findFirst.mockImplementation(async (args: { where?: { id?: string; slug?: string } }) => {
      if (args?.where?.id === 'skill-db-1') return skillRow()
      if (args?.where?.slug === 'demo-skill') return skillRow()
      return null
    })
    prismaMock.workflowSkill.create.mockImplementation(async () => {
      const err = new Error('Unique constraint failed') as Error & { code: string }
      err.code = 'P2002'
      throw err
    })
    await expect(publishWorkflowSkillVersion({
      workspaceOwnerId: 'ws-1',
      skillId: 'skill-db-1',
      input: { systemPrompt: 'X' },
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS', message: expect.stringContaining('发布冲突') })
  })

  it('wraps isDefault reset + create in a single transaction', async () => {
    prismaMock.workflowSkill.create.mockResolvedValue(skillRow({ id: 'skill-db-2', version: 2, isDefault: true }))
    prismaMock.workflowSkill.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.workflowSkill.findFirst.mockImplementation(async (args: { where?: { id?: string; slug?: string } }) => {
      if (args?.where?.id === 'skill-db-1') return skillRow({ isDefault: true })
      if (args?.where?.slug === 'demo-skill') return skillRow({ version: 1, isDefault: true })
      return null
    })

    await publishWorkflowSkillVersion({
      workspaceOwnerId: 'ws-1',
      skillId: 'skill-db-1',
      input: { systemPrompt: 'NEW', isDefault: true },
    })
    expect(prismaMock.$transaction).toHaveBeenCalled()
    expect(prismaMock.workflowSkill.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isDefault: true, track: 'short_drama_commerce', stage: 'script_analysis' }),
      data: { isDefault: false },
    }))
  })
})

// ============================================================
// updateWorkflowSkill: immutable content + meta allowed
// ============================================================
describe('updateWorkflowSkill immutability contract', () => {
  beforeEach(() => {
    prismaMock.workflowSkill.findFirst.mockResolvedValue(skillRow())
    prismaMock.workflowSkill.update.mockResolvedValue(skillRow())
    prismaMock.workflowSkill.updateMany.mockResolvedValue({ count: 0 })
  })

  it('rejects in-place systemPrompt edits with the documented message', async () => {
    await expect(updateWorkflowSkill({
      workspaceOwnerId: 'ws-1',
      skillId: 'skill-db-1',
      input: { systemPrompt: 'NEW' },
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: '已发布版本不可原地修改，请发布为新版本。',
    })
    expect(prismaMock.workflowSkill.update).not.toHaveBeenCalled()
  })

  it('rejects qcRules edits even when other meta fields change', async () => {
    await expect(updateWorkflowSkill({
      workspaceOwnerId: 'ws-1',
      skillId: 'skill-db-1',
      input: { name: 'Renamed', qcRules: { maxChars: 100 } },
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  })

  it('allows meta-only updates (name/description/changeNote/isDefault)', async () => {
    prismaMock.workflowSkill.update.mockResolvedValue(skillRow({ name: 'Renamed', description: 'New desc' }))
    const result = await updateWorkflowSkill({
      workspaceOwnerId: 'ws-1',
      skillId: 'skill-db-1',
      input: { name: 'Renamed', description: 'New desc', isDefault: true },
    })
    expect(result.name).toBe('Renamed')
    expect(prismaMock.workflowSkill.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { isDefault: false },
    }))
  })

  it('accepts an identical systemPrompt without treating it as a content change', async () => {
    prismaMock.workflowSkill.update.mockResolvedValue(skillRow({ name: 'Renamed' }))
    await expect(updateWorkflowSkill({
      workspaceOwnerId: 'ws-1',
      skillId: 'skill-db-1',
      input: { name: 'Renamed', systemPrompt: 'ORIGINAL_PROMPT' },
    })).resolves.toMatchObject({ name: 'Renamed' })
  })

  it('accepts semantically identical nested content with different object key order', async () => {
    prismaMock.workflowSkill.findFirst.mockResolvedValue(skillRow({
      outputSchema: { type: 'object', properties: { shots: { type: 'array', items: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } }, title: { type: 'string' } } },
      qcRules: { maxChars: 100, requiredKeywords: ['shop'] },
      modelPreferences: { llmModelKey: 'model', defaultStageParams: { temperature: 0.4 } },
      fewShotExamples: [{ title: 'demo', input: 'in', output: 'out' }],
    }))
    prismaMock.workflowSkill.update.mockResolvedValue(skillRow({ name: 'Renamed' }))
    await expect(updateWorkflowSkill({
      workspaceOwnerId: 'ws-1', skillId: 'skill-db-1', input: {
        name: 'Renamed',
        outputSchema: { properties: { title: { type: 'string' }, shots: { items: { properties: { b: { type: 'number' }, a: { type: 'number' } }, type: 'object' }, type: 'array' } }, type: 'object' },
        qcRules: { requiredKeywords: ['shop'], maxChars: 100 },
        modelPreferences: { defaultStageParams: { temperature: 0.4 }, llmModelKey: 'model' },
        fewShotExamples: [{ title: 'demo', input: 'in', output: 'out' }],
      },
    })).resolves.toMatchObject({ name: 'Renamed' })
    await expect(updateWorkflowSkill({
      workspaceOwnerId: 'ws-1', skillId: 'skill-db-1', input: { qcRules: { requiredKeywords: ['shop'], maxChars: 99 } },
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  })

  it('routes to publishWorkflowSkillVersion when saveAsNewVersion is true', async () => {
    prismaMock.workflowSkill.create.mockResolvedValue(skillRow({ id: 'skill-db-2', version: 2, systemPrompt: 'NEW' }))
    const result = await updateWorkflowSkill({
      workspaceOwnerId: 'ws-1',
      skillId: 'skill-db-1',
      input: { systemPrompt: 'NEW' },
      saveAsNewVersion: true,
    })
    expect(result.version).toBe(2)
    expect(prismaMock.workflowSkill.update).not.toHaveBeenCalled()
    expect(prismaMock.workflowSkill.create).toHaveBeenCalled()
  })

  it('derives a workspace Skill from a built-in v1 (userId = null) when saveAsNewVersion is true', async () => {
    // Simulate built-in path: isBuiltinSkillId returns true for built-in prefixed ids.
    prismaMock.workflowSkill.findFirst.mockResolvedValue(null)
    prismaMock.workflowSkill.create.mockResolvedValue(skillRow({
      id: 'skill-new',
      userId: 'ws-1',
      slug: 's1-default',
      name: '内置 S1',
      version: 2,
      parentSkillId: 's1-default',
    }))
    // Built-in catalog lookup is needed since getWorkflowSkillById falls through.
    // Use the canonical built-in id from builtin-presets.
    const { BUILTIN_WORKFLOW_SKILLS } = await import('@/lib/batch-workflow/builtin-presets')
    const builtin = BUILTIN_WORKFLOW_SKILLS[0]
    if (!builtin) throw new Error('no builtin')
    prismaMock.workflowSkill.create.mockResolvedValue(skillRow({
      id: 'derived-1',
      userId: 'ws-1',
      slug: builtin.slug,
      name: builtin.name,
      stage: builtin.stage,
      version: 2,
      parentSkillId: builtin.id,
      systemPrompt: 'EDITED',
    }))
    const result = await updateWorkflowSkill({
      workspaceOwnerId: 'ws-1',
      skillId: builtin.id,
      input: { systemPrompt: 'EDITED' },
      saveAsNewVersion: true,
    })
    expect(result.userId).toBe('ws-1')
    expect(result.parentSkillId).toBe(builtin.id)
    expect(result.version).toBe(2)
    expect(prismaMock.workflowSkill.update).not.toHaveBeenCalled()
  })
})

// ============================================================
// toWorkflowSkillSummary strips content fields
// ============================================================
describe('toWorkflowSkillSummary contract', () => {
  it('omits systemPrompt/fewShotExamples/qcRules/modelPreferences/outputSchema', () => {
    const full: WorkflowSkillDTO = {
      id: 's1',
      userId: 'ws-1',
      isBuiltin: false,
      slug: 'demo',
      name: 'Demo',
      track: 'short_drama_commerce',
      stage: 'script_analysis',
      version: 3,
      parentSkillId: 'prev',
      changeNote: 'v3',
      isDefault: true,
      description: 'desc',
      systemPrompt: 'SECRET_PROMPT',
      fewShotExamples: [{ title: 'x', input: 'i', output: 'o' }],
      outputSchema: { secret: true },
      modelPreferences: { llmModelKey: 'nori::nori-gpt' },
      qcRules: { maxChars: 100 },
      createdAt: '2026-11-28T00:00:00.000Z',
      updatedAt: '2026-11-28T00:00:00.000Z',
    }
    const summary: WorkflowSkillSummaryDTO = toWorkflowSkillSummary(full)
    expect(summary.id).toBe('s1')
    expect(summary.name).toBe('Demo')
    expect(summary.version).toBe(3)
    expect(summary.isBuiltin).toBe(false)
    expect(summary.isDefault).toBe(true)
    expect(summary).not.toHaveProperty('systemPrompt')
    expect(summary).not.toHaveProperty('fewShotExamples')
    expect(summary).not.toHaveProperty('qcRules')
    expect(summary).not.toHaveProperty('modelPreferences')
    expect(summary).not.toHaveProperty('outputSchema')
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('SECRET_PROMPT')
    expect(serialized).not.toContain('secret')
  })
})

// ============================================================
// mapBatchItemRow: legacy stageOutputs (no qc/attempt/etc.) still map
// ============================================================
describe('mapBatchItemRow legacy compatibility', () => {
  it('maps a stageOutputs payload that has no qc/attempt/revision fields', () => {
    const mapped = mapBatchItemRow(itemRow({
      revision: undefined,
      stageStates: { script_analysis: { status: 'pending', skillSlug: 'x' } },
      stageOutputs: { script_analysis: { beats: [], fullScriptText: 'old' } },
    }))
    expect(mapped.revision).toBe(0)
    expect(mapped.executionKey).toBeNull()
    expect(mapped.stageStates.script_analysis.status).toBe('pending')
    expect(mapped.stageStates.script_analysis.skillVersion).toBe(1)
    expect(mapped.stageOutputs.script_analysis).toMatchObject({ fullScriptText: 'old' })
    expect(mapped.stageStates.script_analysis).not.toHaveProperty('qcStatus')
    expect(mapped.stageStates.script_analysis).not.toHaveProperty('attempt')
  })
})

// ============================================================
// Summary mapping: list view returns stageOutputs: {} + summary: true
// ============================================================
describe('toBatchItemSummary contract', () => {
  it('emits stageOutputs = {} with summary:true while preserving metadata', () => {
    const detail = mapBatchItemRow(itemRow({
      revision: 5,
      status: 'running',
      stageStates: {
        asset_extraction: { status: 'running', taskIds: ['task-1'] },
      },
      stageOutputs: {
        asset_extraction: { items: [{ id: 'a1', status: 'processing', versions: [] }] },
      },
    }))
    const summary = toBatchItemSummary(detail)
    expect(summary.summary).toBe(true)
    expect(summary.stageOutputs).toEqual({})
    expect(summary.revision).toBe(5)
    expect(summary.hasPendingAsyncTasks).toBe(true)
    expect(summary.stageStates.asset_extraction.taskIds).toEqual(['task-1'])
  })

  it('reports hasPendingAsyncTasks=false when no running stage has taskIds', () => {
    const detail = mapBatchItemRow(itemRow({
      stageStates: { script_analysis: { status: 'pending', taskIds: [] } },
      // Even if legacy stageOutputs indicated pending work, summary uses stageStates only.
      stageOutputs: { asset_extraction: { items: [{ id: 'a1', status: 'processing', versions: [] }] } },
    }))
    const summary = toBatchItemSummary(detail)
    expect(summary.hasPendingAsyncTasks).toBe(false)
  })
})

// ============================================================
// listBatchRuns: SELECT excludes stageOutputs; summary mapper applies
// ============================================================
describe('listBatchRuns summary contract', () => {
  it('excludes stageOutputs from the SELECT and returns summary items', async () => {
    prismaMock.batchRun.findMany.mockResolvedValue([
      runRow({ items: [itemRow({ stageOutputs: undefined })] }),
    ])
    const runs = await listBatchRuns({ workspaceOwnerId: 'ws-1' })
    expect(prismaMock.batchRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        items: expect.objectContaining({
          select: expect.objectContaining({ stageOutputs: false }),
        }),
      }),
    }))
    expect(runs).toHaveLength(1)
    expect(runs[0].items).toHaveLength(1)
    expect((runs[0].items?.[0] as { summary?: boolean }).summary).toBe(true)
    expect(runs[0].items?.[0].stageOutputs).toEqual({})
  })

  it('caps the run limit at 100', async () => {
    prismaMock.batchRun.findMany.mockResolvedValue([])
    await listBatchRuns({ workspaceOwnerId: 'ws-1', limit: 9999 })
    expect(prismaMock.batchRun.findMany.mock.calls[0][0].take).toBe(100)
  })
})

// ============================================================
// getBatchRunWithStatusSync is read-only (no executor.sync, no DB writes)
// ============================================================
describe('getBatchRunWithStatusSync is read-only', () => {
  it('does not import executor or write to the DB', async () => {
    prismaMock.batchRun.findFirst.mockResolvedValue(runRow({ items: [itemRow()] }))
    const run = await getBatchRunWithStatusSync({ workspaceOwnerId: 'ws-1', runId: 'run-1' })
    expect(run?.id).toBe('run-1')
    expect(prismaMock.batchRun.findFirst).toHaveBeenCalled()
    expect(prismaMock.batchItem.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.workflowSkill.update).not.toHaveBeenCalled()
    expect(prismaMock.workflowSkill.updateMany).not.toHaveBeenCalled()
    // Sanity: detail path returns full stageOutputs (not summarized).
    expect(run?.items?.[0]).not.toHaveProperty('summary')
  })
})

// ============================================================
// getBatchRunById returns full detail (no summary flag)
// ============================================================
describe('getBatchRunById detail contract', () => {
  it('returns full stageOutputs and no summary flag on items', async () => {
    prismaMock.batchRun.findFirst.mockResolvedValue(runRow({
      items: [itemRow({ stageOutputs: { script_analysis: { fullScriptText: 'X' } } })],
    }))
    const run = await getBatchRunById({ workspaceOwnerId: 'ws-1', runId: 'run-1', includeItems: true })
    expect(run?.items?.[0].stageOutputs).toEqual({ script_analysis: { fullScriptText: 'X' } })
    expect(run?.items?.[0]).not.toHaveProperty('summary')
  })
})

// ============================================================
// updateWorkflowTemplate rejects cross-workspace skill bindings
// ============================================================
describe('updateWorkflowTemplate cross-workspace skill binding rejection', () => {
  it('rejects a stage whose skillId is owned by another workspace', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      userId: 'ws-1',
      slug: 'demo',
      name: 'Demo',
      track: 'short_drama_commerce',
      description: null,
      stages: [],
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    // DB lookup for the requested skillId finds nothing within (ws-1, null).
    prismaMock.workflowSkill.findMany.mockResolvedValue([])

    await expect(updateWorkflowTemplate({
      workspaceOwnerId: 'ws-1',
      templateId: 'tpl-1',
      input: {
        stages: [
          { stage: 'script_analysis', label: 'S1', skillSlug: 'foreign', skillId: 'skill-from-other-ws', gateMode: 'manual_review', enabled: true },
        ],
      },
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: expect.stringContaining('不属于本工作区'),
    })
  })

  it('allows a stage bound to an in-workspace or built-in Skill id', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      userId: 'ws-1',
      slug: 'demo',
      name: 'Demo',
      track: 'short_drama_commerce',
      description: null,
      stages: [],
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    prismaMock.workflowSkill.findMany.mockResolvedValue([{ id: 'skill-in-ws' }])
    prismaMock.workflowTemplate.update.mockResolvedValue({
      id: 'tpl-1',
      userId: 'ws-1',
      slug: 'demo',
      name: 'Demo',
      track: 'short_drama_commerce',
      description: null,
      stages: [],
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(updateWorkflowTemplate({
      workspaceOwnerId: 'ws-1',
      templateId: 'tpl-1',
      input: {
        stages: [
          { stage: 'script_analysis', label: 'S1', skillSlug: 'x', skillId: 'skill-in-ws', gateMode: 'manual_review', enabled: true },
        ],
      },
    })).resolves.toMatchObject({ id: 'tpl-1' })
  })
})
