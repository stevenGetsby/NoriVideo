import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const auth = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const access = vi.hoisted(() => ({
  getWorkspaceActor: vi.fn(),
  isProjectHiddenFromActor: vi.fn(async () => false),
  workspaceUserWhere: vi.fn(() => ({})),
  findHiddenProjectIds: vi.fn(async () => new Set()),
  projectReadWhere: vi.fn(() => ({})),
}))
const service = vi.hoisted(() => ({
  listWorkflowSkills: vi.fn(),
  createWorkflowSkill: vi.fn(),
  getWorkflowSkillById: vi.fn(),
  listSkillVersions: vi.fn(),
  updateWorkflowSkill: vi.fn(),
  deleteWorkflowSkill: vi.fn(),
  toWorkflowSkillSummary: vi.fn((skill: Record<string, unknown>) => {
    const { systemPrompt, fewShotExamples, qcRules, modelPreferences, outputSchema, ...rest } = skill
    void systemPrompt; void fewShotExamples; void qcRules; void modelPreferences; void outputSchema
    return rest
  }),
}))
const permissions = vi.hoisted(() => ({
  isManagementRole: vi.fn(),
  hasAccountPermissions: vi.fn(),
  normalizeAccountRole: vi.fn((role: string) => role),
}))

vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/collaboration/access', () => access)
vi.mock('@/lib/batch-workflow/service', () => service)
vi.mock('@/lib/account/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/account/permissions')>()
  return {
    ...actual,
    isManagementRole: permissions.isManagementRole,
    hasAccountPermissions: permissions.hasAccountPermissions,
    normalizeAccountRole: permissions.normalizeAccountRole,
  }
})
vi.mock('@/lib/account/request-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/account/request-context')>()
  return {
    ...actual,
    setAccountActorContext: vi.fn(),
    withAccountPermissionContext: vi.fn((_perms: unknown, fn: () => unknown) => fn()),
  }
})

import { GET as skillsGET, POST as skillsPOST } from '@/app/api/batch-workflow/skills/route'
import {
  GET as skillByIdGET,
  PATCH as skillByIdPATCH,
  DELETE as skillByIdDELETE,
} from '@/app/api/batch-workflow/skills/[skillId]/route'

const adminUser: { id: string; role: string; permissions: string[] } = {
  id: 'u-admin',
  role: 'owner',
  permissions: ['admin'],
}
const memberUser: { id: string; role: string; permissions: string[] } = {
  id: 'u-member',
  role: 'member',
  permissions: [],
}

function mockAuth(user: typeof adminUser | typeof memberUser) {
  auth.requireUserAuth.mockResolvedValue({ session: { user } })
  access.getWorkspaceActor.mockReturnValue({ actorId: user.id, workspaceOwnerId: 'ws-1' })
  permissions.isManagementRole.mockImplementation((role: string) => role === 'owner')
  permissions.hasAccountPermissions.mockImplementation((u: typeof adminUser | typeof memberUser) => u.permissions.includes('admin'))
}

const sampleFullSkill = {
  id: 'skill-1',
  userId: 'ws-1',
  isBuiltin: false,
  slug: 'demo',
  name: 'Demo',
  track: 'short_drama_commerce',
  stage: 'script_analysis',
  version: 1,
  parentSkillId: null,
  changeNote: 'v1',
  isDefault: false,
  description: 'desc',
  systemPrompt: 'SECRET_PROMPT',
  fewShotExamples: [{ title: 'x', input: 'i', output: 'o' }],
  outputSchema: { secret: true },
  modelPreferences: { llmModelKey: 'nori::nori-gpt' },
  qcRules: { maxChars: 100 },
  createdAt: '2026-11-28T00:00:00.000Z',
  updatedAt: '2026-11-28T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// GET /api/batch-workflow/skills (list)
// ============================================================
describe('GET /api/batch-workflow/skills (view=summary + non-admin degradation)', () => {
  it('admin without view=summary returns full DTO including systemPrompt', async () => {
    mockAuth(adminUser)
    service.listWorkflowSkills.mockResolvedValue([sampleFullSkill])
    const res = await skillsGET(new NextRequest('http://localhost/api/batch-workflow/skills'), { params: Promise.resolve({}) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.skills[0].systemPrompt).toBe('SECRET_PROMPT')
  })

  it('view=summary strips content fields even for admin', async () => {
    mockAuth(adminUser)
    service.listWorkflowSkills.mockResolvedValue([sampleFullSkill])
    const res = await skillsGET(new NextRequest('http://localhost/api/batch-workflow/skills?view=summary'), { params: Promise.resolve({}) })
    const body = await res.json()
    expect(body.skills[0]).not.toHaveProperty('systemPrompt')
    expect(body.skills[0]).not.toHaveProperty('fewShotExamples')
    expect(body.skills[0]).not.toHaveProperty('qcRules')
    expect(body.skills[0]).not.toHaveProperty('modelPreferences')
    expect(body.skills[0]).not.toHaveProperty('outputSchema')
    expect(body.skills[0].id).toBe('skill-1')
  })

  it('non-admin degrades to summary regardless of view param', async () => {
    mockAuth(memberUser)
    service.listWorkflowSkills.mockResolvedValue([sampleFullSkill])
    const res = await skillsGET(new NextRequest('http://localhost/api/batch-workflow/skills'), { params: Promise.resolve({}) })
    const body = await res.json()
    expect(body.skills[0]).not.toHaveProperty('systemPrompt')
    expect(JSON.stringify(body)).not.toContain('SECRET_PROMPT')
  })

  it('non-admin with explicit view=full still gets summary', async () => {
    mockAuth(memberUser)
    service.listWorkflowSkills.mockResolvedValue([sampleFullSkill])
    const res = await skillsGET(new NextRequest('http://localhost/api/batch-workflow/skills?view=full'), { params: Promise.resolve({}) })
    const body = await res.json()
    expect(body.skills[0]).not.toHaveProperty('systemPrompt')
  })
})

// ============================================================
// GET /api/batch-workflow/skills/[skillId]
// ============================================================
describe('GET /api/batch-workflow/skills/[skillId] non-admin degradation', () => {
  it('admin receives full skill + versions', async () => {
    mockAuth(adminUser)
    service.getWorkflowSkillById.mockResolvedValue(sampleFullSkill)
    service.listSkillVersions.mockResolvedValue([sampleFullSkill])
    const res = await skillByIdGET(new NextRequest('http://localhost/api/batch-workflow/skills/skill-1'), {
      params: Promise.resolve({ skillId: 'skill-1' }),
    })
    const body = await res.json()
    expect(body.skill.systemPrompt).toBe('SECRET_PROMPT')
    expect(body.versions[0].systemPrompt).toBe('SECRET_PROMPT')
  })

  it('non-admin receives summary skill and summary versions', async () => {
    mockAuth(memberUser)
    service.getWorkflowSkillById.mockResolvedValue(sampleFullSkill)
    service.listSkillVersions.mockResolvedValue([sampleFullSkill])
    const res = await skillByIdGET(new NextRequest('http://localhost/api/batch-workflow/skills/skill-1'), {
      params: Promise.resolve({ skillId: 'skill-1' }),
    })
    const body = await res.json()
    expect(body.skill).not.toHaveProperty('systemPrompt')
    expect(body.versions[0]).not.toHaveProperty('systemPrompt')
    expect(JSON.stringify(body)).not.toContain('SECRET_PROMPT')
  })
})

// ============================================================
// POST /api/batch-workflow/skills admin-only
// ============================================================
describe('POST /api/batch-workflow/skills admin-only', () => {
  it('rejects non-admin with 403 FORBIDDEN', async () => {
    mockAuth(memberUser)
    const res = await skillsPOST(new NextRequest('http://localhost/api/batch-workflow/skills', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', stage: 'script_analysis', systemPrompt: 'p' }),
    }), { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(service.createWorkflowSkill).not.toHaveBeenCalled()
  })

  it('allows admin to create', async () => {
    mockAuth(adminUser)
    service.createWorkflowSkill.mockResolvedValue(sampleFullSkill)
    const res = await skillsPOST(new NextRequest('http://localhost/api/batch-workflow/skills', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', stage: 'script_analysis', systemPrompt: 'p' }),
    }), { params: Promise.resolve({}) })
    expect(res.status).toBe(201)
    expect(service.createWorkflowSkill).toHaveBeenCalled()
  })
})

// ============================================================
// PATCH /api/batch-workflow/skills/[skillId] — admin gate & saveAsNewVersion routing
// ============================================================
describe('PATCH /api/batch-workflow/skills/[skillId] admin-only & immutable-content routing', () => {
  it('rejects non-admin', async () => {
    mockAuth(memberUser)
    const res = await skillByIdPATCH(new NextRequest('http://localhost/api/batch-workflow/skills/skill-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'new' }),
    }), { params: Promise.resolve({ skillId: 'skill-1' }) })
    expect(res.status).toBe(403)
    expect(service.updateWorkflowSkill).not.toHaveBeenCalled()
  })

  it('forwards saveAsNewVersion=true to updateWorkflowSkill', async () => {
    mockAuth(adminUser)
    service.updateWorkflowSkill.mockResolvedValue({ ...sampleFullSkill, version: 2 })
    const res = await skillByIdPATCH(new NextRequest('http://localhost/api/batch-workflow/skills/skill-1', {
      method: 'PATCH',
      body: JSON.stringify({ saveAsNewVersion: true, systemPrompt: 'NEW' }),
    }), { params: Promise.resolve({ skillId: 'skill-1' }) })
    expect(res.status).toBe(200)
    expect(service.updateWorkflowSkill).toHaveBeenCalledWith(expect.objectContaining({
      saveAsNewVersion: true,
      input: expect.objectContaining({ systemPrompt: 'NEW' }),
    }))
  })

  it('forwards saveAsNewVersion=false (or omitted) so service rejects content edits', async () => {
    mockAuth(adminUser)
    service.updateWorkflowSkill.mockRejectedValue(
      Object.assign(new Error('已发布版本不可原地修改，请发布为新版本。'), { code: 'INVALID_PARAMS', status: 400 }),
    )
    const res = await skillByIdPATCH(new NextRequest('http://localhost/api/batch-workflow/skills/skill-1', {
      method: 'PATCH',
      body: JSON.stringify({ systemPrompt: 'NEW' }),
    }), { params: Promise.resolve({ skillId: 'skill-1' }) })
    // apiHandler maps the INVALID_PARAMS ApiError to a 4xx response.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(service.updateWorkflowSkill).toHaveBeenCalledWith(expect.objectContaining({
      saveAsNewVersion: false,
    }))
  })
})

// ============================================================
// DELETE /api/batch-workflow/skills/[skillId] admin-only
// ============================================================
describe('DELETE /api/batch-workflow/skills/[skillId] admin-only', () => {
  it('rejects non-admin', async () => {
    mockAuth(memberUser)
    const res = await skillByIdDELETE(new NextRequest('http://localhost/api/batch-workflow/skills/skill-1', {
      method: 'DELETE',
    }), { params: Promise.resolve({ skillId: 'skill-1' }) })
    expect(res.status).toBe(403)
    expect(service.deleteWorkflowSkill).not.toHaveBeenCalled()
  })
})
