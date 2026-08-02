import { beforeEach, describe, expect, it, vi } from 'vitest'

const { projectFindUnique, transaction } = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: projectFindUnique },
    $transaction: transaction,
  },
}))

import {
  ensureSeedanceProjectAssetGroup,
  seedanceProjectAssetGroupName,
} from '@/lib/novel-promotion/seedance-project-asset-group'
import type { SeedanceAssetsClient } from '@/lib/volcengine/seedance-assets-client'

describe('project-scoped Seedance asset groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses one persisted group for every asset in the same Nori project', async () => {
    const state = {
      id: 'project-12345678-abcd',
      name: '海外短剧项目',
      seedanceAssetGroupId: null as string | null,
      seedanceAssetsProjectName: null as string | null,
    }
    projectFindUnique.mockImplementation(async () => ({ ...state }))
    const tx = {
      $queryRaw: vi.fn(async () => []),
      project: {
        findUnique: vi.fn(async () => ({ ...state })),
        update: vi.fn(async ({ data }: { data: Partial<typeof state> }) => {
          Object.assign(state, data)
          return { ...state }
        }),
      },
    }
    transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<string>) => callback(tx))
    const client = {
      listAssetGroups: vi.fn(async () => ({})),
      createAssetGroup: vi.fn(async () => ({ Id: 'group-project-shared' })),
    } as unknown as SeedanceAssetsClient

    const first = await ensureSeedanceProjectAssetGroup({
      projectId: state.id,
      volcengineProjectName: 'default',
      client,
    })
    const second = await ensureSeedanceProjectAssetGroup({
      projectId: state.id,
      volcengineProjectName: 'default',
      client,
    })

    expect(first).toBe('group-project-shared')
    expect(second).toBe('group-project-shared')
    expect(client.createAssetGroup).toHaveBeenCalledTimes(1)
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing deterministic project group returned by Volcengine', async () => {
    const project = {
      id: 'project-existing-1234',
      name: 'Project Alpha',
      seedanceAssetGroupId: null,
      seedanceAssetsProjectName: null,
    }
    projectFindUnique.mockResolvedValue(project)
    const tx = {
      $queryRaw: vi.fn(async () => []),
      project: {
        findUnique: vi.fn(async () => project),
        update: vi.fn(async () => project),
      },
    }
    transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<string>) => callback(tx))
    const expectedName = seedanceProjectAssetGroupName({
      projectId: project.id,
      projectName: project.name,
    })
    const client = {
      listAssetGroups: vi.fn(async () => ({ AssetGroups: [{ Id: 'group-existing', Name: expectedName }] })),
      createAssetGroup: vi.fn(),
    } as unknown as SeedanceAssetsClient

    await expect(ensureSeedanceProjectAssetGroup({
      projectId: project.id,
      volcengineProjectName: 'volc-project',
      client,
    })).resolves.toBe('group-existing')
    expect(client.createAssetGroup).not.toHaveBeenCalled()
  })

  it('keeps project group names within the Volcengine limit', () => {
    const name = seedanceProjectAssetGroupName({
      projectId: 'project-12345678',
      projectName: '非常长的项目名称'.repeat(20),
    })
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toContain('Nori项目素材')
  })
})
